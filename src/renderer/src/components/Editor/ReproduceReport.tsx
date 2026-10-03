import { useEffect, useRef } from 'react'
import type { ReproduceReport as Report } from './cellRunner'

const VERDICT = {
  same: { label: 'Same', className: 'same' },
  different: { label: 'Different', className: 'different' },
  failed: { label: 'Failed', className: 'failed' }
} as const

/** What Reproduce found. Nothing in the note was changed, so this is only shown, never saved. */
export function ReproduceReport({ report, onClose }: { report: Report; onClose(): void }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => closeRef.current?.focus(), [])

  const compared = report.cells.filter((c) => c.comparison)
  const same = compared.filter((c) => c.comparison!.verdict === 'same').length
  const headline = !compared.length
    ? 'There were no saved outputs to compare.'
    : same === compared.length
      ? `${compared.length === 1 ? 'The output is' : `All ${compared.length} outputs are`} the same as recorded.`
      : `${compared.length - same} of ${compared.length} ${compared.length === 1 ? 'output differs' : 'outputs differ'} from what was recorded.`

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal reproduce-modal"
        role="dialog"
        aria-label="Reproduce"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="reproduce-head">
          <h2>Reproduce</h2>
          <button ref={closeRef} className="text-button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className={`reproduce-headline ${same === compared.length ? 'same' : 'different'}`}>{headline}</p>
        <p className={`reproduce-env ${report.environment.exact ? 'exact' : 'inexact'}`}>
          {report.environment.summary}
        </p>
        <ol className="reproduce-cells">
          {report.cells.map((cell, i) => (
            <li key={i}>
              <div className="reproduce-cell-head">
                <code>{cell.label || `Cell ${i + 1}`}</code>
                {cell.comparison ? (
                  <span className={`reproduce-verdict ${VERDICT[cell.comparison.verdict].className}`}>
                    {VERDICT[cell.comparison.verdict].label}
                  </span>
                ) : (
                  <span className="reproduce-verdict none">No saved output</span>
                )}
              </div>
              {cell.comparison && cell.comparison.details.length > 0 && (
                <ul>
                  {cell.comparison.details.map((d, j) => (
                    <li key={j} className={d.same ? 'same' : 'different'}>
                      {d.label}: {d.same ? 'same' : 'different'}
                    </li>
                  ))}
                </ul>
              )}
              {cell.comparison && cell.comparison.inputs.length > 0 && (
                <p className="reproduce-inputs">
                  It read different contents of {cell.comparison.inputs.map((p) => p.split('/').pop()).join(', ')} than
                  the original run.
                </p>
              )}
            </li>
          ))}
        </ol>
        <p className="hint">Nothing in the note was changed. Run a cell to replace its output with a new one.</p>
      </div>
    </div>
  )
}
