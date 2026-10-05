import { useEffect, useMemo, useState } from 'react'
import { freezers, parseLocation, storageBoxes, type StorageBox } from '@shared/records/samples'
import type { SampleSummary } from '@shared/vault/types'
import { useSampleIndex } from '../../state/LinkIndexContext'
import { useSettings } from '../../state/SettingsContext'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'
import { BoxGrid } from './BoxGrid'

type Tab = 'list' | 'freezer'
type SortKey = 'id' | 'kind' | 'location' | 'status' | 'created'

const COLUMNS: { key: SortKey; title: string }[] = [
  { key: 'id', title: 'ID' },
  { key: 'kind', title: 'Type' },
  { key: 'location', title: 'Location' },
  { key: 'status', title: 'Status' },
  { key: 'created', title: 'Created' }
]

const TAB_KEY = 'prem.samples.tab'
const FREEZER_KEY = 'prem.samples.freezer'

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Private windows may refuse; the view just opens on its default next time.
  }
}

const compare = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/** Every sample in the vault as a table, and every box as a map of its wells. */
export function SamplesView() {
  const index = useSampleIndex()
  const ws = useWorkspace()
  const [tab, setTabState] = useState<Tab>(() => (remembered(TAB_KEY) === 'freezer' ? 'freezer' : 'list'))
  const setTab = (next: Tab): void => {
    setTabState(next)
    remember(TAB_KEY, next)
  }
  // "Show in the freezer map" from a sample: open the map at its box, once.
  const [highlight, setHighlight] = useState<string | null>(null)
  const { samplesFocus, clearSamplesFocus } = ws
  useEffect(() => {
    if (!samplesFocus) return
    setHighlight(samplesFocus)
    setTabState('freezer')
    remember(TAB_KEY, 'freezer')
    clearSamplesFocus()
  }, [samplesFocus, clearSamplesFocus])

  const boxes = useMemo(() => (index ? storageBoxes(index.boxes, index.samples) : []), [index])

  return (
    <div className="samples-view">
      <div className="samples-toolbar">
        <div className="segmented" role="tablist" aria-label="Samples view">
          <button
            role="tab"
            aria-selected={tab === 'list'}
            className={tab === 'list' ? 'on' : undefined}
            onClick={() => setTab('list')}
          >
            List
          </button>
          <button
            role="tab"
            aria-selected={tab === 'freezer'}
            className={tab === 'freezer' ? 'on' : undefined}
            onClick={() => setTab('freezer')}
          >
            Freezers
          </button>
        </div>
        <span className="toolbar-spacer" />
        <NewSampleButton />
      </div>
      {!index ? (
        <p className="empty">Loading samples…</p>
      ) : tab === 'list' ? (
        <SampleList samples={index.samples} />
      ) : (
        <FreezerMap boxes={boxes} highlight={highlight} />
      )}
    </div>
  )
}

function NewSampleButton({ location = '', label = 'New sample' }: { location?: string; label?: string }) {
  const ws = useWorkspace()
  const { canWrite } = useVault()
  const folder = useSettings().values['samples.folder']
  if (!canWrite(folder)) return null
  return (
    <button className="primary-button" onClick={() => void ws.newSample(location)}>
      {label}
    </button>
  )
}

function SampleList({ samples }: { samples: SampleSummary[] }) {
  const ws = useWorkspace()
  const [query, setQuery] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: 'id', descending: false })

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const rows = samples.filter(
      (s) =>
        (showAll || s.status === 'available') &&
        words.every((w) => `${s.id} ${s.kind} ${s.location} ${s.createdBy}`.toLowerCase().includes(w))
    )
    rows.sort((a, b) => compare(a[sort.key], b[sort.key]) * (sort.descending ? -1 : 1))
    return rows
  }, [samples, query, showAll, sort])

  if (!samples.length) {
    return (
      <div className="empty centered">
        <div>
          <p>
            No samples yet. A sample is a note with <code>type: sample</code>; New sample makes one with the next ID.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="sample-list">
      <div className="sample-filters">
        <input
          className="search-input"
          type="search"
          placeholder="Filter by ID, type, place or person"
          aria-label="Filter samples"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <label className="sample-show-all">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show used up and
          discarded
        </label>
        <span className="hint">
          {shown.length} of {samples.length}
        </span>
      </div>
      <table className="sample-table">
        <thead>
          <tr>
            {COLUMNS.map((c) => (
              <th
                key={c.key}
                aria-sort={sort.key === c.key ? (sort.descending ? 'descending' : 'ascending') : undefined}
              >
                <button
                  onClick={() => setSort((s) => ({ key: c.key, descending: s.key === c.key ? !s.descending : false }))}
                >
                  {c.title}
                  {sort.key === c.key ? (sort.descending ? ' ↓' : ' ↑') : ''}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={s.path} className={s.status === 'available' ? undefined : 'gone'}>
              <td>
                <button className="sample-open" onClick={() => ws.openNote(s.path)}>
                  {s.id}
                </button>
              </td>
              <td>{s.kind}</td>
              <td>
                {s.box ? (
                  <button
                    className="sample-place"
                    title="Show in the freezer map"
                    onClick={() => ws.showInFreezer(s.box!)}
                  >
                    {s.location}
                  </button>
                ) : (
                  s.location || <span className="hint">not given</span>
                )}
              </td>
              <td>{s.status}</td>
              <td>{s.created}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function FreezerMap({ boxes, highlight }: { boxes: StorageBox[]; highlight: string | null }) {
  const names = useMemo(() => freezers(boxes), [boxes])
  const [freezer, setFreezerState] = useState<string | null>(() => remembered(FREEZER_KEY))
  const setFreezer = (name: string): void => {
    setFreezerState(name)
    remember(FREEZER_KEY, name)
  }
  const current = names.find((n) => n.toLowerCase() === (freezer ?? '').toLowerCase()) ?? names[0] ?? null

  useEffect(() => {
    const name = highlight ? parseLocation(highlight).container[0] : null
    if (!name) return
    setFreezerState(name)
    remember(FREEZER_KEY, name)
  }, [highlight])

  useEffect(() => {
    if (!highlight) return
    document.querySelector(`[data-box="${CSS.escape(highlight.toLowerCase())}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight, current])

  if (!names.length) {
    return (
      <div className="empty centered">
        <p>
          No freezers yet. Give a sample a location such as <code>Freezer A, box 1, B3</code> and its box appears here.
        </p>
      </div>
    )
  }

  const inFreezer = boxes.filter((b) => b.container[0]?.toLowerCase() === current?.toLowerCase())
  return (
    <div className="freezer-map">
      {names.length > 1 && (
        <div className="segmented" role="tablist" aria-label="Freezer">
          {names.map((n) => (
            <button
              key={n}
              role="tab"
              aria-selected={n === current}
              className={n === current ? 'on' : undefined}
              onClick={() => setFreezer(n)}
            >
              {n}
            </button>
          ))}
        </div>
      )}
      <div className="freezer-boxes">
        {inFreezer.map((box) => (
          <BoxPanel key={box.location} box={box} focused={box.location.toLowerCase() === highlight?.toLowerCase()} />
        ))}
      </div>
    </div>
  )
}

function BoxPanel({ box, focused }: { box: StorageBox; focused: boolean }) {
  const ws = useWorkspace()
  const [selected, setSelected] = useState<string | null>(null)
  const used = [...box.wells.values()].reduce((n, list) => n + list.length, 0)
  const clashes = [...box.wells.entries()].filter(([, list]) => list.length > 1).map(([well]) => well)
  const here = selected ? (box.wells.get(selected) ?? []) : []
  const place = selected ? `${box.location}, ${selected}` : ''

  const activate = (well: string): void => {
    const first = box.wells.get(well)?.[0]
    if (first) ws.openNote(first.path)
  }

  return (
    <section className={`box-panel${focused ? ' focused' : ''}`} data-box={box.location.toLowerCase()}>
      <header>
        <h3>{box.container.slice(1).join(', ') || box.location}</h3>
        <span className="hint">
          {box.rows} × {box.columns} · {used} of {box.rows * box.columns} places used
        </span>
        {box.path && (
          <button className="text-button" onClick={() => ws.openNote(box.path!)}>
            Box note
          </button>
        )}
      </header>
      {clashes.length > 0 && (
        <p className="error-text" role="status">
          Two samples share {clashes.join(', ')}. Open them and move one.
        </p>
      )}
      <BoxGrid box={box} selected={selected} onSelect={setSelected} onActivate={activate} />
      <div className="box-detail" aria-live="polite">
        {!selected ? (
          <span className="hint">Choose a place to see what's there. Enter or double-click opens a sample.</span>
        ) : here.length ? (
          here.map((s) => (
            <span key={s.path} className="box-detail-sample">
              <button className="sample-open" onClick={() => ws.openNote(s.path)}>
                {s.id}
              </button>{' '}
              {s.kind}
            </span>
          ))
        ) : (
          <>
            <span>{selected} is free.</span>
            <NewSampleButton location={place} label={`New sample at ${selected}`} />
          </>
        )}
      </div>
      {box.unplaced.length > 0 && (
        <p className="hint">
          Also in this box, without a place on the grid:{' '}
          {box.unplaced.map((s, i) => (
            <span key={s.path}>
              {i > 0 && ', '}
              <button className="sample-open" onClick={() => ws.openNote(s.path)}>
                {s.id}
              </button>
            </span>
          ))}
        </p>
      )}
    </section>
  )
}
