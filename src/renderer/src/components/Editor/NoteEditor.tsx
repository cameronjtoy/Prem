import { useEffect, useRef, useState } from 'react'
import { isInside } from '@shared/paths'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'
import { createExtensions, refreshLinks, type EditorHost } from './extensions'
import { NoteSession, type Conflict, type SaveStatus } from './NoteSession'

const STATUS_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  dirty: 'Editing…',
  saving: 'Saving…',
  error: 'Not saved'
}

export function NoteEditor({ path, cursor }: { path: string; cursor: number | null }) {
  const { resolver, noteTitles, subscribe } = useVault()
  const { openLink, registerEditor, showNotice } = useWorkspace()
  const hostRef = useRef<HTMLDivElement>(null)
  const sessionRef = useRef<NoteSession | null>(null)
  const [status, setStatus] = useState<SaveStatus>('saved')
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

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
          (s) => createExtensions(host, () => void s.save()),
          { onStatus: setStatus, onConflict: setConflict, onError: setError },
          cursor
        )
        sessionRef.current = session
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
  }, [path, registerEditor])

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
        {!loading && <span className={`save-status ${status}`}>{STATUS_LABEL[status]}</span>}
      </div>
      {conflict && (
        <div className="banner warning">
          <span>This note was changed outside the app while you had unsaved edits.</span>
          <button onClick={() => sessionRef.current?.reloadFromDisk()}>Use version on disk</button>
          <button onClick={() => void sessionRef.current?.keepMine()}>Keep my edits</button>
        </div>
      )}
      {error && <div className="banner error">{error}</div>}
      <div className="editor-host" ref={hostRef} />
    </div>
  )
}
