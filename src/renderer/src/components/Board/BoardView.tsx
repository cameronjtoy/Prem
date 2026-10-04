import { useEffect, useMemo, useState, type DragEvent, type FormEvent } from 'react'
import { mayMoveJob } from '@shared/records/workflows'
import type { JobSummary } from '@shared/vault/types'
import { vaultClient } from '../../services/vaultClient'
import { useLinkIndex } from '../../state/LinkIndexContext'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'

const WORKFLOW_KEY = 'prem.board.workflow'
const DONE = '\u0000done'
const OTHER = '\u0000other'

function remembered(): string | null {
  try {
    return localStorage.getItem(WORKFLOW_KEY)
  } catch {
    return null
  }
}

function remember(workflow: string): void {
  try {
    localStorage.setItem(WORKFLOW_KEY, workflow)
  } catch {
    // Private windows may refuse; the board just opens on the default next time.
  }
}

const same = (a: string | null | undefined, b: string | null | undefined): boolean =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase()

/** Where a job sits on the board: one of the workflow's stages, Done, or Other if its stage isn't listed. */
function columnOf(job: JobSummary, stages: string[]): string {
  if (job.status === 'done') return DONE
  return stages.find((s) => same(s, job.stage)) ?? OTHER
}

/** What dropping a job on a column would do. */
type Move = { kind: 'advance' } | { kind: 'back'; stage: string } | null

function moveFor(job: JobSummary, column: string): Move {
  const stages = job.stages.map((s) => s.name)
  const at = job.status === 'done' ? stages.length : stages.findIndex((s) => same(s, job.stage))
  const target = column === DONE ? stages.length : stages.findIndex((s) => same(s, column))
  if (at < 0 || target < 0) return null
  if (job.status !== 'done' && target === at + 1) return { kind: 'advance' }
  if (target < at) return { kind: 'back', stage: stages[target] }
  return null
}

/**
 * The board: every job of one workflow, in a column per stage. Dragging a card to the next column completes
 * its stage; dragging it back sends it back to that stage, with a reason. Cards open the job.
 */
export function BoardView() {
  const index = useLinkIndex()
  const { info, canWrite } = useVault()
  const ws = useWorkspace()
  const jobs = useMemo(() => index?.jobs ?? [], [index])
  const workflows = useMemo(() => index?.workflows ?? [], [index])
  const me = info?.author ?? ''

  // Every workflow with a note or a job, so jobs of a deleted workflow still have a board.
  const names = useMemo(() => {
    const all = new Map<string, string>()
    for (const w of workflows) all.set(w.title.toLowerCase(), w.title)
    for (const j of jobs)
      if (j.workflow && !all.has(j.workflow.toLowerCase())) all.set(j.workflow.toLowerCase(), j.workflow)
    return [...all.values()].sort((a, b) => a.localeCompare(b))
  }, [workflows, jobs])

  const busiest = useMemo(() => {
    let best: string | null = null
    let most = -1
    for (const name of names) {
      const open = jobs.filter((j) => same(j.workflow, name) && j.status !== 'done').length
      if (open > most) [best, most] = [name, open]
    }
    return best
  }, [names, jobs])

  const [chosen, setChosen] = useState<string | null>(remembered)
  const workflow = names.find((n) => same(n, chosen)) ?? busiest
  const [who, setWho] = useState<'everyone' | 'me' | string>('everyone')
  const [showDone, setShowDone] = useState(false)
  const [locked, setLocked] = useState<Set<string>>(new Set())
  const [dragging, setDragging] = useState<JobSummary | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [sendBack, setSendBack] = useState<{ job: JobSummary; stage: string; reason: string } | null>(null)

  const ofWorkflow = useMemo(() => jobs.filter((j) => same(j.workflow, workflow)), [jobs, workflow])
  const stages = useMemo(() => {
    const note = workflows.find((w) => same(w.title, workflow))
    if (note?.stages.length) return note.stages
    // No workflow note: use the stages of its most recent job.
    const latest = [...ofWorkflow].sort((a, b) => b.created.localeCompare(a.created))[0]
    return latest?.stages.map((s) => s.name) ?? []
  }, [workflows, workflow, ofWorkflow])
  const people = useMemo(
    () => [...new Set(ofWorkflow.map((j) => j.assignee).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [ofWorkflow]
  )
  const shown = ofWorkflow.filter(
    (j) => (showDone || j.status !== 'done') && (who === 'everyone' || same(j.assignee, who === 'me' ? me : who))
  )
  const hasOther = shown.some((j) => columnOf(j, stages) === OTHER)
  const columns = [...stages, ...(hasOther ? [OTHER] : []), ...(showDone ? [DONE] : [])]

  // Signed jobs are locked: their cards can't be moved.
  const paths = ofWorkflow.map((j) => j.path).join('\n')
  useEffect(() => {
    let cancelled = false
    const list = paths ? paths.split('\n') : []
    void Promise.all(
      list.map((p) =>
        vaultClient
          .recordStatus(p)
          .then((r) => (r.locked ? p : null))
          .catch(() => null)
      )
    ).then((found) => !cancelled && setLocked(new Set(found.filter((p): p is string => !!p))))
    return () => {
      cancelled = true
    }
  }, [paths, index?.version])

  /** Why you can't move this job, or null if you can. */
  const blocked = (job: JobSummary): string | null => {
    if (locked.has(job.path)) return 'This job is signed, so it can no longer move.'
    if (!canWrite(job.path)) return "You don't have permission to change this job."
    if (info?.user && !mayMoveJob(job.assignee, { name: info.user, role: info.role }))
      return `Only ${job.assignee} (the assignee) or a PI can move this job on.`
    return null
  }

  const advance = async (job: JobSummary): Promise<void> => {
    const at = job.stages.findIndex((s) => same(s.name, job.stage))
    const next = job.stages[at + 1]
    const question = next
      ? `Complete ${job.stage} and hand the job to ${next.assignee || 'the next stage'} (${next.name})?`
      : `Complete ${job.stage} and finish the job?`
    if (window.confirm(question)) await ws.advanceJob(job.path)
  }

  const drop = (column: string) => (e: DragEvent) => {
    e.preventDefault()
    setOver(null)
    const job = dragging
    setDragging(null)
    if (!job) return
    const move = moveFor(job, column)
    if (move?.kind === 'advance') void advance(job)
    else if (move?.kind === 'back') setSendBack({ job, stage: move.stage, reason: '' })
  }

  const submitSendBack = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!sendBack) return
    const { job, stage, reason } = sendBack
    setSendBack(null)
    await ws.sendJobBack(job.path, stage, reason)
  }

  if (!names.length) {
    return (
      <div className="board empty-state">
        <h2>No workflows yet</h2>
        <p>Create a note from the Workflow template, list its stages, then choose New job on it.</p>
      </div>
    )
  }

  const title = (column: string): string => (column === DONE ? 'Done' : column === OTHER ? 'Other' : column)
  return (
    <div className="board">
      <div className="board-toolbar">
        <label>
          Workflow
          <select
            value={workflow ?? ''}
            onChange={(e) => {
              setChosen(e.target.value)
              remember(e.target.value)
            }}
          >
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          Assigned to
          <select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="everyone">Everyone</option>
            {me && <option value="me">Me ({me})</option>}
            {people
              .filter((p) => !same(p, me))
              .map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
          </select>
        </label>
        <label className="board-check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> Show done
        </label>
        <span className="board-count">
          {shown.length} {shown.length === 1 ? 'job' : 'jobs'}
        </span>
      </div>
      <div className="board-columns" role="list">
        {columns.map((column) => {
          const cards = shown.filter((j) => columnOf(j, stages) === column)
          const move = dragging ? moveFor(dragging, column) : null
          const target = dragging ? (move ? 'can-drop' : 'no-drop') : ''
          return (
            <section
              key={column}
              role="listitem"
              aria-label={title(column)}
              className={`board-column ${target} ${over === column && move ? 'over' : ''}`}
              data-column={title(column)}
              onDragOver={(e) => {
                if (!move) return
                e.preventDefault()
                setOver(column)
              }}
              onDragLeave={() => setOver((o) => (o === column ? null : o))}
              onDrop={drop(column)}
            >
              <h3>
                {title(column)} <span className="board-column-count">{cards.length}</span>
              </h3>
              {column === OTHER && <p className="hint">Their stage isn't in the workflow any more.</p>}
              {cards.map((job) => {
                const reason = blocked(job)
                const at = job.stages.findIndex((s) => same(s.name, job.stage))
                return (
                  <article
                    key={job.path}
                    className={`board-card${same(job.assignee, me) ? ' mine' : ''}${reason ? ' fixed' : ''}`}
                    draggable={!reason}
                    title={reason ?? 'Drag to the next stage to complete this one, or back to redo a stage'}
                    data-job={job.path}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('text/plain', job.path)
                      e.dataTransfer.effectAllowed = 'move'
                      setDragging(job)
                    }}
                    onDragEnd={() => {
                      setDragging(null)
                      setOver(null)
                    }}
                  >
                    <button className="board-card-open" onClick={() => ws.openNote(job.path)}>
                      {job.title.replace(/^.* job /, '')}
                    </button>
                    <div className="board-card-meta">
                      {job.assignee && <span className="board-chip">{job.assignee}</span>}
                      <span className="board-status">{job.status}</span>
                      {job.runOpen && (
                        <span className="board-run" title="A run for this stage is started and not complete yet">
                          run open
                        </span>
                      )}
                      {job.samples > 0 && (
                        <span>
                          {job.samples} {job.samples === 1 ? 'sample' : 'samples'}
                        </span>
                      )}
                    </div>
                    {!reason && job.status !== 'done' && (
                      <div className="board-card-actions">
                        {at >= 0 && (
                          <button onClick={() => void advance(job)}>
                            {at === job.stages.length - 1 ? 'Complete job' : 'Complete stage'}
                          </button>
                        )}
                        {at > 0 && (
                          <button onClick={() => setSendBack({ job, stage: job.stages[at - 1].name, reason: '' })}>
                            Send back…
                          </button>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </section>
          )
        })}
      </div>
      {sendBack && (
        <div className="modal-backdrop" onMouseDown={() => setSendBack(null)}>
          <form
            className="modal board-send-back"
            role="dialog"
            aria-label="Send back"
            onMouseDown={(e) => e.stopPropagation()}
            onSubmit={(e) => void submitSendBack(e)}
            onKeyDown={(e) => e.key === 'Escape' && setSendBack(null)}
          >
            <h2>Send {sendBack.job.title.replace(/^.* job /, 'the job of ')} back</h2>
            <label>
              To
              <select value={sendBack.stage} onChange={(e) => setSendBack({ ...sendBack, stage: e.target.value })}>
                {sendBack.job.stages
                  .slice(
                    0,
                    sendBack.job.status === 'done'
                      ? sendBack.job.stages.length
                      : Math.max(sendBack.job.stages.findIndex((s) => same(s.name, sendBack.job.stage)) + 1, 1)
                  )
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                      {s.assignee ? ` (${s.assignee})` : ''}
                    </option>
                  ))}
              </select>
            </label>
            <input
              autoFocus
              className="text-input"
              placeholder="Why? e.g. low yield, redo the prep"
              aria-label="Why the stage is being redone"
              value={sendBack.reason}
              onChange={(e) => setSendBack({ ...sendBack, reason: e.target.value })}
            />
            <div className="board-send-back-actions">
              <button type="button" className="text-button" onClick={() => setSendBack(null)}>
                Cancel
              </button>
              <button type="submit" className="primary-button">
                Send back
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
