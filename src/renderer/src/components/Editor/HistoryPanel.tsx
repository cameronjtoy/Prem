import { useEffect, useMemo, useState } from 'react'
import { diffLines, type DiffLine } from '@shared/diff'
import { groupSessions, type HistoryEntry } from '@shared/history'
import { errorMessage, vaultClient } from '../../services/vaultClient'

const CONTEXT = 2

const KIND_LABEL: Record<HistoryEntry['kind'], string> = {
  save: 'Saved',
  external: 'Changed outside Prem',
  renamed: 'Renamed',
  deleted: 'Deleted',
  signed: 'Signed',
  witnessed: 'Witnessed',
  amended: 'Amended'
}

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Changed lines with a little context around them; long unchanged stretches collapse to "…". */
function hunks(lines: DiffLine[]): (DiffLine | null)[] {
  const keep = lines.map((l) => l.type !== 'same')
  const show = lines.map((_, i) => keep.slice(Math.max(0, i - CONTEXT), i + CONTEXT + 1).some(Boolean))
  const out: (DiffLine | null)[] = []
  lines.forEach((l, i) => {
    if (show[i]) out.push(l)
    else if (out[out.length - 1] !== null) out.push(null)
  })
  return out
}

/**
 * Every recorded version of a note, grouped into editing sessions. Picking one shows what changed
 * between it and the note as it is now, and it can be restored as a normal (undoable) edit.
 */
export function HistoryPanel({
  path,
  current,
  readOnly,
  onRestore,
  onClose
}: {
  path: string
  current: () => string
  readOnly: boolean
  onRestore(content: string): void
  onClose(): void
}) {
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [selected, setSelected] = useState<HistoryEntry | null>(null)
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    vaultClient
      .history(path)
      .then((list) => {
        setEntries(list)
        const sessions = groupSessions(list)
        // Start on the version before the current one: that's usually what people want to compare with.
        const pick = sessions[1] ?? sessions[0]
        setSelected(pick ? pick[pick.length - 1] : null)
      })
      .catch((err) => setError(errorMessage(err)))
  }, [path])

  useEffect(() => {
    setContent(null)
    if (!selected || !selected.hash) return
    vaultClient
      .readVersion(path, selected.id)
      .then(setContent)
      .catch((err) => setError(errorMessage(err)))
  }, [path, selected])

  const sessions = useMemo(() => (entries ? groupSessions(entries) : []), [entries])
  const diff = useMemo(() => (content === null ? null : hunks(diffLines(content, current()))), [content, current])
  const same = diff !== null && diff.every((l) => l === null || l.type === 'same')

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal history-modal"
        role="dialog"
        aria-label="Note history"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        tabIndex={-1}
      >
        <div className="history-head">
          <h2>History</h2>
          <span className="hint">Every save is kept. Newest first.</span>
          <button className="text-button" onClick={onClose}>
            Close
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        <div className="history-body">
          <ul className="history-list">
            {entries?.length === 0 && <li className="empty">No history yet. It starts with the next save.</li>}
            {sessions.map((session) => {
              const last = session[session.length - 1]
              return (
                <li
                  key={last.id}
                  className={selected?.id === last.id ? 'selected' : undefined}
                  onClick={() => setSelected(last)}
                >
                  <span className="history-when">{when(last.time)}</span>
                  <span className="history-who">
                    {KIND_LABEL[last.kind]}
                    {last.author ? ` by ${last.author}` : ''}
                    {session.length > 1 ? ` · ${session.length} saves` : ''}
                    {last.kind === 'renamed' && last.from ? ` from ${last.from}` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
          <div className="history-diff">
            {selected && !selected.hash && <p className="empty">This entry has no content to compare.</p>}
            {selected?.hash && diff === null && <p className="empty">Loading…</p>}
            {same && <p className="empty">This version is the same as the note now.</p>}
            {diff && !same && (
              <>
                <p className="hint">
                  Changes from this version (<span className="diff-removed-key">removed</span>) to the note now (
                  <span className="diff-added-key">added</span>)
                </p>
                <pre className="diff">
                  {diff.map((l, i) =>
                    l === null ? (
                      <div key={i} className="diff-gap">
                        …
                      </div>
                    ) : (
                      <div key={i} className={`diff-${l.type}`}>
                        {l.type === 'added' ? '+ ' : l.type === 'removed' ? '− ' : '  '}
                        {l.text || ' '}
                      </div>
                    )
                  )}
                </pre>
              </>
            )}
            {!readOnly && content !== null && !same && (
              <div className="history-actions">
                <button className="primary-button" onClick={() => onRestore(content)}>
                  Restore this version
                </button>
                <span className="hint">Restoring is a normal edit: you can undo it, and it's kept in history too.</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
