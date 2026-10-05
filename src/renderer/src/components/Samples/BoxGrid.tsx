import { useRef, type KeyboardEvent } from 'react'
import { wellName, type StorageBox } from '@shared/records/samples'

/**
 * A storage box drawn as rows of wells. Filled wells show the sample's ID; two samples in one well are
 * marked as a clash. One well is focusable at a time and the arrow keys move between them, so the grid is
 * one stop when tabbing through the page.
 */
export function BoxGrid({
  box,
  selected,
  onSelect,
  onActivate,
  disableTaken = false,
  takenBy = null,
  here: hereNow = null
}: {
  box: StorageBox
  /** The selected well's name, e.g. "B4". */
  selected: string | null
  onSelect(well: string): void
  /** Enter or double-click on a well. */
  onActivate?(well: string): void
  /** In a picker: wells holding another sample are shown as unavailable. */
  disableTaken?: boolean
  /** In a picker: the sample being moved, which doesn't count as taking its own well. */
  takenBy?: string | null
  /** In a picker: where the sample is now. */
  here?: string | null
}) {
  const grid = useRef<HTMLDivElement>(null)
  const names = Array.from({ length: box.rows }, (_row, row) =>
    Array.from({ length: box.columns }, (_column, column) => wellName({ row, column }))
  )
  const focusable = selected && names.flat().includes(selected) ? selected : 'A1'

  const occupants = (well: string) => (box.wells.get(well) ?? []).filter((s) => s.path !== takenBy)

  const move = (e: KeyboardEvent, row: number, column: number): void => {
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1]
    }
    if (e.key === 'Enter' && onActivate) {
      e.preventDefault()
      onActivate(names[row][column])
      return
    }
    const d = step[e.key]
    if (!d) return
    e.preventDefault()
    const r = Math.min(box.rows - 1, Math.max(0, row + d[0]))
    const c = Math.min(box.columns - 1, Math.max(0, column + d[1]))
    onSelect(names[r][c])
    grid.current?.querySelector<HTMLButtonElement>(`[data-well="${names[r][c]}"]`)?.focus()
  }

  return (
    <div
      className="box-grid"
      ref={grid}
      role="grid"
      aria-label={`${box.location}: ${box.rows} rows by ${box.columns} columns`}
      style={{ gridTemplateColumns: `1.6em repeat(${box.columns}, minmax(2.4em, 1fr))` }}
    >
      <div role="row" className="box-grid-row">
        <span />
        {names[0].map((_, c) => (
          <span key={c} role="columnheader" className="box-grid-label">
            {c + 1}
          </span>
        ))}
      </div>
      {names.map((cells, r) => (
        <div key={r} role="row" className="box-grid-row">
          <span role="rowheader" className="box-grid-label">
            {cells[0].replace(/\d+$/, '')}
          </span>
          {cells.map((well, c) => {
            const here = occupants(well)
            const clash = here.length > 1
            const now = well === hereNow ? ' (where it is now)' : ''
            const label = here.length
              ? `${well}: ${here.map((s) => `${s.id}${s.kind ? `, ${s.kind}` : ''}`).join(' and ')}${clash ? ' (two samples here)' : ''}`
              : `${well}: empty${now}`
            return (
              <span key={well} role="gridcell" className="well-cell" aria-selected={selected === well}>
                <button
                  type="button"
                  data-well={well}
                  className={`well${here.length ? ' filled' : ''}${clash ? ' clash' : ''}${selected === well ? ' selected' : ''}${well === hereNow ? ' current' : ''}`}
                  tabIndex={well === focusable ? 0 : -1}
                  aria-label={label}
                  title={label}
                  // aria-disabled rather than disabled, so the arrow keys can still pass over taken wells.
                  aria-disabled={disableTaken && here.length > 0 ? true : undefined}
                  onClick={() => onSelect(well)}
                  onDoubleClick={() => onActivate?.(well)}
                  onKeyDown={(e) => move(e, r, c)}
                >
                  {here.length ? here[0].id.replace(/^[A-Za-z]+-/, '') : ''}
                </button>
              </span>
            )
          })}
        </div>
      ))}
    </div>
  )
}
