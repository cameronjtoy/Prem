import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import {
  containerKey,
  formatLocation,
  parseLocation,
  parseWell,
  placeRefusal,
  SAMPLE_STATUSES,
  storageBoxes,
  wellName,
  type SampleStatus
} from '@shared/records/samples'
import { useSampleIndex } from '../../state/LinkIndexContext'
import { useWorkspace } from '../../state/WorkspaceContext'
import { BoxGrid } from './BoxGrid'

/** The strip above a sample: its ID, where it is, and moving it or marking it used up. */
export function SampleBar({
  path,
  fields,
  readOnly,
  moveRequest,
  onMove,
  onStatus
}: {
  path: string
  fields: Record<string, string>
  readOnly: boolean
  /** Bumped to open the Move dialog, e.g. from the command palette. */
  moveRequest: number
  onMove(location: string): void
  onStatus(status: SampleStatus): void
}) {
  const ws = useWorkspace()
  const [moving, setMoving] = useState(false)
  const first = useRef(moveRequest)
  useEffect(() => {
    if (moveRequest !== first.current && !readOnly) setMoving(true)
  }, [moveRequest, readOnly])

  const location = fields.location ?? ''
  const box = parseLocation(location).container
  const status = (SAMPLE_STATUSES as readonly string[]).includes(fields.status ?? '')
    ? (fields.status as SampleStatus)
    : 'available'

  return (
    <>
      <div className={`run-bar sample-bar${status === 'available' ? '' : ' gone'}`}>
        <span className="run-kind">Sample{fields.id ? ` · ${fields.id}` : ''}</span>
        <span className="run-detail">
          {fields['sample-type'] ? `${fields['sample-type']} · ` : ''}
          {location ? (
            box.length ? (
              <button
                className="run-link"
                title="Show in the freezer map"
                onClick={() => ws.showInFreezer(box.join(', '))}
              >
                {location}
              </button>
            ) : (
              location
            )
          ) : (
            'No location yet'
          )}
        </span>
        {readOnly ? (
          <span className="run-detail">{status}</span>
        ) : (
          <>
            <select
              className="sample-status"
              aria-label="Status"
              value={status}
              onChange={(e) => onStatus(e.target.value as SampleStatus)}
            >
              {SAMPLE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s[0].toUpperCase() + s.slice(1)}
                </option>
              ))}
            </select>
            <button className="run-primary" onClick={() => setMoving(true)}>
              Move…
            </button>
          </>
        )}
      </div>
      {/* Beside the bar, not in it, so the bar's button styles don't reach the dialog. */}
      {moving && (
        <MoveSample
          samplePath={path}
          current={location}
          onCancel={() => setMoving(false)}
          onMove={(to) => {
            setMoving(false)
            onMove(to)
          }}
        />
      )}
    </>
  )
}

/** Choose a new place: type it, or pick a box and a free well on its grid. */
function MoveSample({
  samplePath,
  current,
  onCancel,
  onMove
}: {
  samplePath: string
  current: string
  onCancel(): void
  onMove(location: string): void
}) {
  const index = useSampleIndex()
  const boxes = useMemo(() => (index ? storageBoxes(index.boxes, index.samples) : []), [index])
  const [location, setLocation] = useState(current)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => input.current?.focus(), [])

  const parsed = parseLocation(location)
  const box = boxes.find((b) => containerKey(b.container) === containerKey(parsed.container)) ?? null
  const refusal = location.trim() === current.trim() ? null : placeRefusal(boxes, location, samplePath)
  const unchanged = location.trim() === current.trim()

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!refusal && !unchanged) onMove(location.trim())
  }

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <form
        className="modal move-modal"
        role="dialog"
        aria-label="Move sample"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onCancel()}
        onSubmit={submit}
      >
        <h2>Move sample</h2>
        <label className="move-field">
          <span>New location</span>
          <input
            ref={input}
            className="text-input"
            value={location}
            placeholder="Freezer A, box 1, B3"
            onChange={(e) => setLocation(e.target.value)}
          />
        </label>
        {boxes.length > 0 && (
          <label className="move-field">
            <span>Box</span>
            <select
              value={box ? box.location : ''}
              onChange={(e) => setLocation(formatLocation(parseLocation(e.target.value).container, null))}
            >
              <option value="">{box ? '' : parsed.container.length ? 'A new box' : 'Choose a box…'}</option>
              {boxes.map((b) => (
                <option key={b.location} value={b.location}>
                  {b.location}
                </option>
              ))}
            </select>
          </label>
        )}
        {box && (
          <BoxGrid
            box={box}
            selected={parsed.well ? wellName(parsed.well) : null}
            onSelect={(well) => setLocation(formatLocation(box.container, parseWell(well)))}
            onActivate={(well) => {
              const to = formatLocation(box.container, parseWell(well))
              if (!placeRefusal(boxes, to, samplePath)) onMove(to)
            }}
            disableTaken
            takenBy={samplePath}
            here={(() => {
              const now = parseLocation(current)
              return now.well && containerKey(now.container) === containerKey(box.container) ? wellName(now.well) : null
            })()}
          />
        )}
        {refusal && <p className="error-text">{refusal}</p>}
        <div className="move-actions">
          <button type="button" className="text-button" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={!!refusal || unchanged}>
            Move
          </button>
        </div>
      </form>
    </div>
  )
}
