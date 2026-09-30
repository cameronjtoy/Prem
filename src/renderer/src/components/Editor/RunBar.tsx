import { parseFrontmatter } from '@shared/frontmatter'
import { notebookFolder } from '@shared/notebook'
import { runProgress } from '@shared/runs'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'

export interface NoteMeta {
  type: string | null
  fields: Record<string, string>
  progress: { done: number; total: number }
}

export function readMeta(text: string): NoteMeta {
  const { fields } = parseFrontmatter(text)
  const type = fields.type ?? null
  return { type, fields, progress: type === 'run' ? runProgress(text) : { done: 0, total: 0 } }
}

function protocolName(link: string | undefined): string {
  return link?.replace(/^\[\[|\]\]$/g, '') || 'protocol'
}

/** The strip above a protocol (to start a run) or a run (to see progress, log deviations and finish it). */
export function RunBar({
  path,
  meta,
  readOnly,
  onAddDeviation,
  onComplete
}: {
  path: string
  meta: NoteMeta
  readOnly: boolean
  onAddDeviation(): void
  onComplete(): void
}) {
  const { info, canWrite } = useVault()
  const ws = useWorkspace()

  if (meta.type === 'protocol') {
    const canStart = canWrite(notebookFolder(info?.user))
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
