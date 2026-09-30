import { useEffect, useRef, useState } from 'react'
import { EditorView } from '@codemirror/view'
import { isInside } from '@shared/paths'
import { addDeviation, completeRun } from '@shared/runs'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'
import { createExtensions, refreshLinks, type EditorHost } from './extensions'
import { NoteSession, type Conflict, type SaveStatus } from './NoteSession'
import { readMeta, RunBar, type NoteMeta } from './RunBar'

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Editing…',
  saving: 'Saving…',
  error: 'Not saved'
}

export function NoteEditor({ path, cursor }: { path: string; cursor: number | null }) {
  const { resolver, noteTitles, subscribe, canWrite } = useVault()
  const { openLink, registerEditor, showNotice } = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<NoteSession | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [meta, setMeta] = useState<NoteMeta>(() => readMeta(''))
  const readOnly = !canWrite(path)

  // The editor is created once per note; these refs give its callbacks the latest values.
  const latest = useRef({ resolver, noteTitles, openLink, showNotice })
  latest.current = { resolver, noteTitles, openLink, showNotice }

  useEffect(() => {
    let cancelled = false
    const host: EditorHost = {
      resolve: (target) => latest.current.resolver(target, path),
      openLink: (target) => void latest.current.openLink(target, path),
      openExternal: (url) => vaultClient.openExternal(url).catch((e) => latest.current.showNotice(errorMessage(e))),
      noteTitles: () => latest.current.noteTitles
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
            createExtensions(host, () => void s.save(), readOnly),
            EditorView.updateListener.of((u) => u.docChanged && setMeta(readMeta(u.state.doc.toString())))
          ],
          { onStatus: setStatus, onConflict: setConflict, onError: setError },
          cursor
        )
        sessionRef.current = session
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
  }, [path, registerEditor, readOnly])

  useEffect(
    () =>
      subscribe((changes) => {
        if (changes.some((c) => c.type !== 'deleted' && isInside(path, c.path))) {
          void sessionRef.current?.handleExternalChange()
        }
      }),
    [path, subscribe]
  )

  useEffect(() => {
    sessionRef.current?.view.dispatch({ effects: refreshLinks.of(null) })
  }, [resolver])

  /** Applies a whole-note rewrite as the smallest edit, so undo and the cursor behave naturally. */
  const rewrite = (fn: (text: string) => { text: string; cursor?: number }): void => {
    const view = sessionRef.current?.view
    if (!view) return
    const before = view.state.doc.toString()
    const { text, cursor } = fn(before)
    let from = 0
    while (from < before.length && from < text.length && before[from] === text[from]) from++
    let end = 0
    while (end < before.length - from && end < text.length - from && before[before.length - 1 - end] === text[text.length - 1 - end]) end++
    view.dispatch({
      changes: { from, to: before.length - end, insert: text.slice(from, text.length - end) },
      selection: cursor === undefined ? undefined : { anchor: cursor },
      scrollIntoView: cursor !== undefined
    })
    view.focus()
  }

  const onComplete = (): void => {
    const left = meta.progress.total - meta.progress.done
    if (left > 0 && !window.confirm(`${left} step${left === 1 ? " isn't" : "s aren't"} ticked. Complete the run anyway?`)) return
    rewrite((text) => ({ text: completeRun(text, new Date()) }))
  }

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
        {!loading &&
          (readOnly ? (
            <span className="save-status" title="You can read this note but not edit it">
              Read only
            </span>
          ) : (
            <span className={`save-status ${status}`}>{STATUS_LABEL[status]}</span>
          ))}
      </div>
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
    </div>
  )
}
