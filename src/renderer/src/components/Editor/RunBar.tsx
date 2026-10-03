import { parseFrontmatter } from '@shared/notes/frontmatter'
import { runProgress } from '@shared/records/runs'
import { jobState, linkTarget, parseStages, redoableStages, type JobState } from '@shared/records/workflows'
import { useEffect, useState, type FormEvent } from 'react'
import { useNotebookFolder } from '../../state/SettingsContext'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'

export interface NoteMeta {
  type: string | null
  fields: Record<string, string>
  progress: { done: number; total: number }
  /** For a job, where it's at; for a workflow, its stages (as a job with nothing logged). */
  job: JobState | null
}

export function readMeta(text: string): NoteMeta {
  const { fields } = parseFrontmatter(text)
  const type = fields.type ?? null
  return {
    type,
    fields,
    progress: type === 'run' ? runProgress(text) : { done: 0, total: 0 },
    job: type === 'job' ? jobState(text) : type === 'workflow' ? { ...jobState(''), stages: parseStages(text) } : null
  }
}

function protocolName(link: string | undefined): string {
  return link?.replace(/^\[\[|\]\]$/g, '') || 'protocol'
}

const count = (n: number, one: string): string => `${n} ${one}${n === 1 ? '' : 's'}`

/**
 * The strip above a protocol (to start a run), a run (to see progress, log deviations and finish it),
 * a workflow (to start a job) or a job (to run its stages and hand it on).
 */
export function RunBar({
  path,
  meta,
  readOnly,
  onAddDeviation,
  onComplete,
  onStartStageRun,
  onCompleteStage,
  onRedoStage,
  redoRequest
}: {
  path: string
  meta: NoteMeta
  readOnly: boolean
  onAddDeviation(): void
  onComplete(): void
  onStartStageRun(): void
  onCompleteStage(): void
  onRedoStage(stage: string, reason: string): void
  /** Bumped to open the "Send back" form, e.g. from the command palette. */
  redoRequest: number
}) {
  const { info, canWrite } = useVault()
  const ws = useWorkspace()
  const notebook = useNotebookFolder(info?.user)

  if (meta.type === 'workflow') {
    const stages = meta.job?.stages.length ?? 0
    return (
      <div className="run-bar">
        <span className="run-kind">Workflow{meta.fields.version ? ` · version ${meta.fields.version}` : ''}</span>
        <span className="run-detail">
          {stages ? count(stages, 'stage') : 'Add stages to the Stages table to start jobs.'} · Jobs of this workflow
          are listed under Backlinks.
        </span>
        {stages > 0 && canWrite('Jobs') && (
          <button className="run-primary" onClick={() => void ws.newJob(path)}>
            ▶ New job
          </button>
        )}
      </div>
    )
  }

  if (meta.type === 'job' && meta.job) {
    return (
      <JobBar
        path={path}
        meta={meta}
        job={meta.job}
        readOnly={readOnly}
        canStartRun={canWrite(notebook)}
        canRerun={canWrite('Jobs')}
        redoRequest={redoRequest}
        onStartStageRun={onStartStageRun}
        onCompleteStage={onCompleteStage}
        onRedoStage={onRedoStage}
      />
    )
  }

  if (meta.type === 'protocol') {
    const canStart = canWrite(notebook)
    return (
      <div className="run-bar">
        <span className="run-kind">Protocol{meta.fields.version ? ` · version ${meta.fields.version}` : ''}</span>
        <span className="run-detail">Runs of this protocol are listed under Backlinks.</span>
        {canStart && (
          <button className="run-primary" onClick={() => void ws.startRun(path)}>
            ▶ Start run
          </button>
        )}
      </div>
    )
  }

  if (meta.type !== 'run') return null
  const { fields, progress } = meta
  const complete = fields.status === 'complete'
  const name = protocolName(fields.protocol)
  const job = linkTarget(fields.job)
  return (
    <div className={`run-bar${complete ? ' complete' : ''}`}>
      <span className="run-kind">{complete ? 'Completed run' : 'Run in progress'}</span>
      <span className="run-detail">
        <button className="run-link" onClick={() => void ws.openLink(name, path)}>
          {name}
        </button>
        {fields.operator ? ` · ${fields.operator}` : ''} · started {fields.started || '—'}
        {complete && fields.finished ? ` · finished ${fields.finished}` : ''}
      </span>
      {job && (
        <button
          className="run-link run-job"
          title={`Part of ${job}${fields.stage ? `, stage ${fields.stage}` : ''}`}
          onClick={() => void ws.openLink(job, path)}
        >
          Job: {job}
        </button>
      )}
      {progress.total > 0 && (
        <span className="run-progress" title={`${progress.done} of ${progress.total} steps done`}>
          <span className="run-progress-bar" style={{ width: `${(progress.done / progress.total) * 100}%` }} />
          <span className="run-progress-label">
            {progress.done}/{progress.total} steps
          </span>
        </span>
      )}
      {!readOnly && !complete && (
        <>
          <button onClick={onAddDeviation}>Add deviation</button>
          <button className="run-primary" onClick={onComplete}>
            Complete run
          </button>
        </>
      )}
    </div>
  )
}

/** The bar above a job: where it is, the next step, sending it back to a stage, and running it again. */
function JobBar({
  path,
  meta,
  job,
  readOnly,
  canStartRun,
  canRerun,
  redoRequest,
  onStartStageRun,
  onCompleteStage,
  onRedoStage
}: {
  path: string
  meta: NoteMeta
  job: JobState
  readOnly: boolean
  canStartRun: boolean
  canRerun: boolean
  redoRequest: number
  onStartStageRun(): void
  onCompleteStage(): void
  onRedoStage(stage: string, reason: string): void
}) {
  const ws = useWorkspace()
  const { stages, index, current, status, openRow } = job
  const done = status === 'done'
  const workflow = linkTarget(meta.fields.workflow) ?? 'workflow'
  const rerunOf = linkTarget(meta.fields['rerun-of'])
  const finished = done ? stages.length : Math.max(index, 0)
  const redoable = redoableStages(job)
  const [redo, setRedo] = useState<{ stage: string; reason: string } | null>(null)

  useEffect(() => {
    if (redoRequest && !readOnly && redoable.length)
      setRedo({ stage: (current ?? redoable[redoable.length - 1]).name, reason: '' })
    // Only a new request opens the form.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [redoRequest])

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    if (!redo) return
    onRedoStage(redo.stage, redo.reason)
    setRedo(null)
  }

  return (
    <>
      <div className={`run-bar job-bar${done ? ' complete' : ''}`}>
        <span className="run-kind">{done ? 'Job done' : status === 'open' ? 'New job' : 'Job in progress'}</span>
        <span className="run-detail">
          <button className="run-link" onClick={() => void ws.openLink(workflow, path)}>
            {workflow}
          </button>
          {done
            ? meta.fields.finished
              ? ` · finished ${meta.fields.finished}`
              : ''
            : current
              ? ` · stage ${index + 1} of ${stages.length}: ${current.name}${meta.fields.assignee ? ` · ${meta.fields.assignee}` : ''}`
              : ` · the stage "${meta.fields.stage ?? ''}" isn't in the Stages table`}
        </span>
        {rerunOf && (
          <button
            className="run-link run-job"
            title={`A rerun of ${rerunOf}`}
            onClick={() => void ws.openLink(rerunOf, path)}
          >
            Rerun of {rerunOf}
          </button>
        )}
        {stages.length > 0 && (
          <span className="run-progress" title={`${finished} of ${count(stages.length, 'stage')} done`}>
            <span className="run-progress-bar" style={{ width: `${(finished / stages.length) * 100}%` }} />
            <span className="run-progress-label">
              {finished}/{count(stages.length, 'stage')}
            </span>
          </span>
        )}
        {openRow?.run && (
          <button onClick={() => void ws.openLink(openRow.run!, path)} title={openRow.run}>
            Open run
          </button>
        )}
        {!readOnly && redoable.length > 0 && !redo && (index > 0 || done || job.log.length > 0) && (
          <button
            onClick={() => setRedo({ stage: (current ?? redoable[redoable.length - 1]).name, reason: '' })}
            title="Send the job back to a stage to do it again. Earlier runs stay in the stage log."
          >
            ↺ Send back…
          </button>
        )}
        {canRerun && stages.length > 0 && (
          <button
            onClick={() => void ws.rerunJob(path)}
            title="Start a new job with the same stages and samples, linked to this one"
          >
            Run again
          </button>
        )}
        {!readOnly && current && (
          <>
            {current.protocol && !openRow && canStartRun && (
              <button onClick={onStartStageRun} title={`Start a run of ${current.protocol}`}>
                ▶ Start run
              </button>
            )}
            <button className="run-primary" onClick={onCompleteStage}>
              {index === stages.length - 1 ? 'Complete job' : 'Complete stage'}
            </button>
          </>
        )}
      </div>
      {redo && (
        <form className="job-redo" onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && setRedo(null)}>
          <label>
            Send back to
            <select value={redo.stage} onChange={(e) => setRedo({ ...redo, stage: e.target.value })}>
              {redoable.map((s) => (
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
            value={redo.reason}
            onChange={(e) => setRedo({ ...redo, reason: e.target.value })}
          />
          <button type="submit" className="run-primary">
            Send back
          </button>
          <button type="button" onClick={() => setRedo(null)}>
            Cancel
          </button>
        </form>
      )}
    </>
  )
}
