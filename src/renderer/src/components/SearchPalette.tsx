import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { SearchHit } from '@shared/search/search'
import { errorMessage, vaultClient } from '../services/vaultClient'
import { useWorkspace } from '../state/WorkspaceContext'

const DEBOUNCE_MS = 80

function highlight(text: string, ranges: [number, number][]): ReactNode[] {
  const out: ReactNode[] = []
  let at = 0
  for (const [start, end] of ranges) {
    if (start < at) continue
    if (start > at) out.push(text.slice(at, start))
    out.push(<mark key={start}>{text.slice(start, end)}</mark>)
    at = end
  }
  out.push(text.slice(at))
  return out
}

/** ⌘K: search every note you can read, and open one at the match. */
export function SearchPalette({ onClose }: { onClose(): void }) {
  const { openNote } = useWorkspace()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [selected, setSelected] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const listRef = useRef<HTMLUListElement>(null)

  useEffect(() => {
    if (!query.trim()) {
      setHits([])
      return
    }
    let stale = false
    const timer = setTimeout(() => {
      vaultClient
        .search(query)
        .then((found) => {
          if (stale) return
          setHits(found)
          setSelected(0)
          setError(null)
        })
        .catch((err) => !stale && setError(errorMessage(err)))
    }, DEBOUNCE_MS)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [query])

  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const open = (hit: SearchHit | undefined): void => {
    if (!hit) return
    onClose()
    openNote(hit.path, hit.matches[0]?.offset ?? null)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal search-modal"
        role="dialog"
        aria-label="Search notes"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => Math.min(s + 1, hits.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter') open(hits[selected])
        }}
      >
        <input
          autoFocus
          className="text-input search-input"
          placeholder='Search notes, protocols and runs… (use "quotes" for a phrase)'
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {error && <p className="error-text">{error}</p>}
        {query.trim() && hits.length === 0 && !error && <p className="empty">No notes match.</p>}
        <ul className="search-results" ref={listRef} role="listbox">
          {hits.map((hit, i) => (
            <li
              key={hit.path}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : undefined}
              onMouseEnter={() => setSelected(i)}
              onClick={() => open(hit)}
            >
              <div className="search-title">
                <span>{highlight(hit.title, hit.titleRanges)}</span>
                <span className="search-path">{hit.path.replace(/\/?[^/]+$/, '') || 'vault'}</span>
              </div>
              {hit.matches.map((m) => (
                <div key={m.line} className="search-line">
                  <span className="search-line-no">{m.line}</span>
                  <span>{highlight(m.text, m.ranges)}</span>
                </div>
              ))}
            </li>
          ))}
        </ul>
        <p className="hint">↑↓ to choose, Enter to open at the match, Esc to close.</p>
      </div>
    </div>
  )
}
