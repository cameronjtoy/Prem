import { useMemo } from 'react'
import { plainSnippet } from '@shared/notes/snippet'
import { splitLinkText } from '@shared/notes/wikilinks'
import { noteTitle } from '@shared/vault/paths'
import { useLinkIndex } from '../../state/LinkIndexContext'
import { useWorkspace } from '../../state/WorkspaceContext'

function linkLabel(inner: string): string {
  const { target, alias } = splitLinkText(inner)
  return alias ?? target
}

function Snippet({ text }: { text: string }) {
  const parts = plainSnippet(text).split(/(\[\[[^[\]\n]+\]\])/)
  return (
    <p className="snippet">
      {parts.map((part, i) =>
        part.startsWith('[[') ? <mark key={i}>{linkLabel(part.slice(2, -2))}</mark> : <span key={i}>{part}</span>
      )}
    </p>
  )
}

export function BacklinksPanel() {
  const snapshot = useLinkIndex()
  const { active, openNote, openLink } = useWorkspace()
  const path = active?.path

  const backlinks = (path && snapshot?.backlinks[path]) || []
  const outgoing = useMemo(() => {
    const seen = new Set<string>()
    return ((path && snapshot?.outgoing[path]) || []).filter((l) => {
      const key = l.resolved ?? `?${l.target.toLowerCase()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [path, snapshot])

  if (!path) {
    return (
      <div className="side-panel">
        <div className="pane-toolbar">
          <span className="pane-title">Links</span>
        </div>
        <p className="empty">Open a note to see what links to it.</p>
      </div>
    )
  }

  return (
    <div className="side-panel">
      <div className="pane-toolbar">
        <span className="pane-title">Links</span>
      </div>
      <div className="side-scroll">
        <section>
          <h3>
            Backlinks <span className="count">{backlinks.length}</span>
          </h3>
          {backlinks.length === 0 && <p className="empty">No other notes link here yet.</p>}
          {backlinks.map((b) => (
            <button key={b.source} className="link-card" onClick={() => openNote(b.source)}>
              <span className="link-title">{noteTitle(b.source)}</span>
              {b.snippets.slice(0, 3).map((s, i) => (
                <Snippet key={i} text={s} />
              ))}
            </button>
          ))}
        </section>
        <section>
          <h3>
            Outgoing links <span className="count">{outgoing.length}</span>
          </h3>
          {outgoing.length === 0 && <p className="empty">This note doesn't link anywhere.</p>}
          {outgoing.map((l) =>
            l.resolved ? (
              <button key={l.resolved} className="link-row" onClick={() => openNote(l.resolved!)}>
                {noteTitle(l.resolved)}
              </button>
            ) : (
              <button
                key={`?${l.target}`}
                className="link-row unresolved"
                title="This note doesn't exist yet — click to create it"
                onClick={() => void openLink(l.target, path)}
              >
                {l.target}
              </button>
            )
          )}
        </section>
      </div>
    </div>
  )
}
