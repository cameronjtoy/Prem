import { useCallback, useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { resolveAttachment } from '@shared/attachments/attachments'
import { isInside } from '@shared/vault/paths'
import { addDeviation, completeRun } from '@shared/records/runs'
import { EMPTY_STATUS, type RecordCheck } from '@shared/records/signatures'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { currentSettings, useSettings } from '../../state/SettingsContext'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'
import { keyFor, useCommand } from '../../commands/registry'
import { ExportIcon, HistoryIcon } from '../icons'
import { createExtensions, optionExtensions, optionsCompartment, refreshLinks, type EditorHost } from './extensions'
import {
  insertAtCursor,
  insertWikilink,
  nowStamp,
  toggleHeading,
  toggleTaskAtCursor,
  toggleWrap
} from './extensions/formatting'
import { HistoryPanel } from './HistoryPanel'
import { NoteSession, type Conflict, type SaveStatus } from './NoteSession'
import { RecordBar } from './RecordBar'
import { readMeta, RunBar, type NoteMeta } from './RunBar'

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Editing…',
  saving: 'Saving…',
  error: 'Not saved'
}

export function NoteEditor({ path, cursor }: { path: string; cursor: number | null }) {
  const { resolver, noteTitles, subscribe, canWrite } = useVault()
  const { openLink, registerEditor, showNotice, exportPdf, startRun } = useWorkspace()
  const { values: settings } = useSettings()
  const spellcheck = settings['editor.spellcheck']
  const lineNumbers = settings['editor.lineNumbers']
  const hostRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<NoteSession | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<NoteMeta>(() => readMeta(''))
  const [showHistory, setShowHistory] = useState(false)
  const currentText = useCallback(() => sessionRef.current?.view.state.doc.toString() ?? '', [])
  const [record, setRecord] = useState<RecordCheck | null>(null)
  const [amending, setAmending] = useState<string | null>(null)
  const amendingRef = useRef(amending)
  amendingRef.current = amending
  const canEdit = canWrite(path)
  // A signed note is read-only until someone with write access starts an amendment.
  const readOnly = !canEdit || (!!record?.locked && !amending)
  const recordLoaded = record !== null

  const refreshRecord = useCallback(
    () =>
      vaultClient
        .recordStatus(path)
        .then(setRecord)
        .catch(() => setRecord((r) => r ?? { ...EMPTY_STATUS, chainOk: true })),
    [path]
  )

  useEffect(() => {
    setRecord(null)
    setAmending(null)
    void refreshRecord()
  }, [refreshRecord])

  // The editor is created once per note; these refs give its callbacks the latest values.
  const latest = useRef({ resolver, noteTitles, openLink, showNotice })
  latest.current = { resolver, noteTitles, openLink, showNotice }

  useEffect(() => {
    // Wait for the signing status, so a signed note opens read-only instead of flickering editable.
    if (!recordLoaded) return
    let cancelled = false
    const host: EditorHost = {
      resolve: (target) => latest.current.resolver(target, path),
      openLink: (target) => void latest.current.openLink(target, path),
      openExternal: (url) => vaultClient.openExternal(url).catch((e) => latest.current.showNotice(errorMessage(e))),
      noteTitles: () => latest.current.noteTitles,
      resolveFile: (url) => resolveAttachment(path, url),
      loadFile: (file) => vaultClient.readBinary(file),
      openFile: (file) => void vaultClient.openFile(file).catch((e) => latest.current.showNotice(errorMessage(e))),
      addAttachment: async (fileName, data) => (await vaultClient.addAttachment(path, fileName, data)).markdown,
      notify: (message) => latest.current.showNotice(message)
    }

    vaultClient
      .read(path)
      .then((file) => {
        if (cancelled || !hostRef.current) return
        const session = new NoteSession(
          path,
          file,
          hostRef.current,
          (s) => [
            createExtensions(host, () => void s.save(), readOnly, {
              spellcheck: currentSettings()['editor.spellcheck'],
              lineNumbers: currentSettings()['editor.lineNumbers']
            }),
            EditorView.updateListener.of((u) => u.docChanged && setMeta(readMeta(u.state.doc.toString())))
          ],
          {
            onStatus: setStatus,
            onConflict: setConflict,
            onError: setError,
            onAmended: () => {
              setAmending(null)
              void refreshRecord()
            },
            autosaveDelay: () => currentSettings()['editor.autosaveDelay']
          },
          cursor
        )
        sessionRef.current = session
        if (amendingRef.current) session.amend(amendingRef.current)
        setMeta(readMeta(file.content))
        registerEditor({ path, flush: () => session.save(), discard: () => session.discard() })
        setLoading(false)
        // Don't steal focus from the file tree's rename box when a new note is being named.
        if (!(document.activeElement instanceof HTMLInputElement)) session.view.focus()
      })
      .catch((err) => !cancelled && setError(`Couldn't open note: ${errorMessage(err)}`))

    return () => {
      cancelled = true
      sessionRef.current?.close()
      sessionRef.current = null
      registerEditor(null)
    }
    // `cursor` is deliberately left out: it only matters when the note is first opened.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [path, registerEditor, readOnly, recordLoaded, refreshRecord])

  useEffect(
    () =>
      subscribe((changes) => {
        if (changes.some((c) => c.type !== 'deleted' && isInside(path, c.path))) {
          void sessionRef.current?.handleExternalChange()
          // Someone may have signed or witnessed it.
          void refreshRecord()
        }
      }),
    [path, subscribe, refreshRecord]
  )

  useEffect(() => {
    sessionRef.current?.view.dispatch({ effects: refreshLinks.of(null) })
  }, [resolver])

  useEffect(() => {
    sessionRef.current?.view.dispatch({
      effects: optionsCompartment.reconfigure(optionExtensions({ spellcheck, lineNumbers }))
    })
  }, [spellcheck, lineNumbers])

  /** Applies a whole-note rewrite as the smallest edit, so undo and the cursor behave naturally. */
  const rewrite = (fn: (text: string) => { text: string; cursor?: number }): void => {
    const view = sessionRef.current?.view
    if (!view) return
    const before = view.state.doc.toString()
    const { text, cursor: anchor } = fn(before)
    let from = 0
    while (from < before.length && from < text.length && before[from] === text[from]) from++
    let end = 0
    while (
      end < before.length - from &&
      end < text.length - from &&
      before[before.length - 1 - end] === text[text.length - 1 - end]
    )
      end++
    view.dispatch({
      changes: { from, to: before.length - end, insert: text.slice(from, text.length - end) },
      selection: anchor === undefined ? undefined : { anchor },
      scrollIntoView: anchor !== undefined
    })
    view.focus()
  }

  const onComplete = (): void => {
    const left = meta.progress.total - meta.progress.done
    if (
      left > 0 &&
      !window.confirm(`${left} step${left === 1 ? " isn't" : "s aren't"} ticked. Complete the run anyway?`)
    )
      return
    rewrite((text) => ({ text: completeRun(text, new Date()) }))
  }

  const [signRequest, setSignRequest] = useState(0)
  const view = (): EditorView | undefined => sessionRef.current?.view
  const editable = (): boolean => !loading && !readOnly && !!view()
  const onLine = (test: RegExp) => (): boolean => {
    const v = view()
    return !!v && editable() && test.test(v.state.doc.lineAt(v.state.selection.main.head).text)
  }
  const canSign =
    !loading &&
    canEdit &&
    !!record &&
    !record.locked &&
    (record.timesSigned > 0 || ['experiment', 'run', 'daily', 'protocol'].includes(meta.type ?? ''))

  useCommand(
    'note.save',
    () => void sessionRef.current?.save(),
    () => !loading && !readOnly
  )
  useCommand(
    'note.history',
    () => setShowHistory(true),
    () => !loading
  )
  useCommand(
    'note.attach',
    async () => {
      try {
        const added = await vaultClient.pickAttachments(path)
        const v = view()
        if (added.length && v) insertAtCursor(v, added.join('\n'))
      } catch (err) {
        showNotice(`Couldn't attach: ${errorMessage(err)}`)
      }
    },
    editable
  )
  useCommand(
    'note.insertDateTime',
    () => view() && insertAtCursor(view()!, nowStamp(new Date(), settings['editor.timestampFormat'])),
    editable
  )
  useCommand(
    'note.sign',
    () => setSignRequest((n) => n + 1),
    () => canSign
  )
  useCommand(
    'run.start',
    () => void startRun(path),
    () => !loading && meta.type === 'protocol'
  )
  useCommand(
    'run.addDeviation',
    () => rewrite((text) => addDeviation(text, new Date())),
    () => editable() && meta.type === 'run' && meta.fields.status !== 'complete'
  )
  useCommand('format.task', () => view() && toggleTaskAtCursor(view()!), onLine(/^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\]/))
  useCommand('format.bold', () => view() && toggleWrap(view()!, '**'), editable)
  useCommand('format.italic', () => view() && toggleWrap(view()!, '*'), editable)
  useCommand('format.strike', () => view() && toggleWrap(view()!, '~~'), editable)
  useCommand('format.link', () => view() && insertWikilink(view()!), editable)
  useCommand('format.heading1', () => view() && toggleHeading(view()!, 1), editable)
  useCommand('format.heading2', () => view() && toggleHeading(view()!, 2), editable)
  useCommand('format.heading3', () => view() && toggleHeading(view()!, 3), editable)

  const crumbs = path.replace(/\.md$/i, '').split('/')

  return (
    <div className="note-editor">
      <div className="note-header">
        <div className="breadcrumb" title={path}>
          {crumbs.map((c, i) => (
            <span key={i} className={i === crumbs.length - 1 ? 'crumb current' : 'crumb'}>
              {c}
            </span>
          ))}
        </div>
        {!loading && (
          <button
            className="icon-button"
            title={`Export as PDF, with signatures and history check (${keyFor('note.exportPdf')})`}
            onClick={() => void exportPdf(path)}
          >
            <ExportIcon />
          </button>
        )}
        {!loading && (
          <button
            className="icon-button"
            title={`History: every saved version of this note (${keyFor('note.history')})`}
            onClick={() => setShowHistory(true)}
          >
            <HistoryIcon />
          </button>
        )}
        {!loading &&
          (readOnly ? (
            <span
              className="save-status"
              title={
                canEdit
                  ? 'Signed records are locked. Use Amend to change it.'
                  : 'You can read this note but not edit it'
              }
            >
              {canEdit ? 'Locked' : 'Read only'}
            </span>
          ) : (
            <span className={`save-status ${status}`}>{STATUS_LABEL[status]}</span>
          ))}
      </div>
      {!loading && (
        <RecordBar
          path={path}
          type={meta.type}
          status={record}
          amending={amending}
          canEdit={canEdit}
          signRequest={signRequest}
          onSign={async (statement) => {
            try {
              await sessionRef.current?.save()
              setRecord(await vaultClient.sign(path, statement || undefined))
            } catch (err) {
              showNotice(`Couldn't sign: ${errorMessage(err)}`)
            }
          }}
          onWitness={async () => {
            try {
              setRecord(await vaultClient.witness(path))
            } catch (err) {
              showNotice(`Couldn't witness: ${errorMessage(err)}`)
            }
          }}
          onAmend={setAmending}
        />
      )}
      {!loading && (
        <RunBar
          path={path}
          meta={meta}
          readOnly={readOnly}
          onAddDeviation={() => rewrite((text) => addDeviation(text, new Date()))}
          onComplete={onComplete}
        />
      )}
      {conflict && (
        <div className="banner warning">
          <span>This note was changed somewhere else while you had unsaved edits.</span>
          <button onClick={() => sessionRef.current?.reloadFromDisk()}>Use version on disk</button>
          <button onClick={() => void sessionRef.current?.keepMine()}>Keep my edits</button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="editor-host" ref={hostRef} />
      {showHistory && (
        <HistoryPanel
          path={path}
          current={currentText}
          readOnly={readOnly}
          onRestore={(content) => {
            setShowHistory(false)
            rewrite(() => ({ text: content, cursor: 0 }))
          }}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  )
}
