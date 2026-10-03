import { useEffect, useRef } from 'react'
import { diffRequirements, requirementLines, riskyLine, type EnvironmentApproval } from '@shared/analysis/trust'

/** What to ask about before running: packages to install, and code not approved on this computer. */
export interface RunApprovalRequest {
  environment: EnvironmentApproval | null
  code: string[]
  /** Who changed the note last: a name, '' for a change made outside Prem, or null if unknown. */
  changedBy: string | null
  /** Your name, so a change you made yourself isn't pointed out. */
  you: string
}

function who(changedBy: string | null, you: string, what: string): string | null {
  if (changedBy === null || (changedBy && changedBy === you)) return null
  return changedBy
    ? `${changedBy} changed ${what} last.`
    : `${what[0].toUpperCase()}${what.slice(1)} was changed outside Prem, for example by a sync service or another program.`
}

function PackageLine({ line, change }: { line: string; change?: 'added' | 'removed' }) {
  const risk = change === 'removed' ? null : riskyLine(line)
  return (
    <li className={`approve-package ${change ?? ''} ${risk ? 'risky' : ''}`}>
      <code>
        {change === 'added' ? '+ ' : change === 'removed' ? '− ' : ''}
        {line}
      </code>
      {risk && <span className="approve-risk">{risk}</span>}
    </li>
  )
}

/**
 * Asks before Prem installs packages or runs code that this computer hasn't approved. Both can run anything
 * with your access to your files, so the dialog shows exactly what would run, and who changed it.
 */
export function ApproveRun({ request, onAnswer }: { request: RunApprovalRequest; onAnswer(ok: boolean): void }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => cancelRef.current?.focus(), [])
  const { environment, code } = request
  const diff = environment?.previous ? diffRequirements(environment.previous, environment.text) : null
  const lines = environment ? requirementLines(environment.text) : []
  const action = environment && code.length ? 'Install and run' : environment ? 'Install' : 'Run'
  const noteWho = code.length ? who(request.changedBy, request.you, 'this note') : null
  const envWho = environment ? who(environment.changedBy, request.you, environment.file) : null

  return (
    <div className="modal-backdrop" onMouseDown={() => onAnswer(false)}>
      <div
        className="modal approve-modal"
        role="dialog"
        aria-label={environment && !code.length ? 'Install packages' : 'Run code'}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onAnswer(false)}
      >
        <h2>{environment && !code.length ? 'Install these packages?' : 'Run this on your computer?'}</h2>
        <p className="approve-warning">
          Code and package installs run with your access to your files. Go ahead only if you trust where they came from.
        </p>

        {environment && (
          <section className="approve-section approve-environment">
            <h3>{environment.previous ? `${environment.file} changed` : `Packages from ${environment.file}`}</h3>
            {envWho && <p className="approve-who">{envWho}</p>}
            <ul className="approve-packages">
              {diff
                ? [
                    ...diff.added.map((l) => <PackageLine key={`+${l}`} line={l} change="added" />),
                    ...diff.removed.map((l) => <PackageLine key={`-${l}`} line={l} change="removed" />)
                  ]
                : lines.map((l) => <PackageLine key={l} line={l} />)}
            </ul>
          </section>
        )}

        {code.length > 0 && (
          <section className="approve-section approve-code">
            <h3>
              {code.length === 1
                ? 'Code not run on this computer before'
                : `${code.length} cells not run on this computer before`}
            </h3>
            {noteWho && <p className="approve-who">{noteWho}</p>}
            {code.map((c, i) => (
              <pre key={i} className="approve-cell">
                <code>{c}</code>
              </pre>
            ))}
          </section>
        )}

        <div className="approve-actions">
          <button ref={cancelRef} className="text-button" onClick={() => onAnswer(false)}>
            Cancel
          </button>
          <button className="primary-button" onClick={() => onAnswer(true)}>
            {action}
          </button>
        </div>
        <p className="hint">Prem remembers what you approve on this computer, and asks again if it changes.</p>
      </div>
    </div>
  )
}
