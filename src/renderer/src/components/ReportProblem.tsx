import { useEffect, useRef, useState } from 'react'
import { formatReport, issueUrl } from '@shared/diagnostics'
import { errorMessage, vaultClient } from '../services/vaultClient'

/**
 * Help → Report a problem. Shows exactly what a report would contain, with the vault's location, the home
 * folder and access tokens taken out. Nothing is sent by Prem: the person opens the GitHub issue themselves,
 * where they can still edit it, or copies the text to send another way.
 */
export function ReportProblem({ onClose }: { onClose(): void }) {
  const [report, setReport] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    vaultClient
      .diagnostics()
      .then((info) => setReport(formatReport(info)))
      .catch((e) => setError(errorMessage(e)))
    closeRef.current?.focus()
  }, [])

  const copy = (): void => {
    if (!report) return
    void navigator.clipboard.writeText(report).then(() => setCopied(true))
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal report-modal"
        role="dialog"
        aria-label="Report a problem"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <h2>Report a problem</h2>
        <p>
          This is everything the report contains. Prem doesn't send it anywhere: <strong>Open GitHub issue</strong>{' '}
          opens it in your browser, where you can change it before posting. Where your vault is, your home folder and
          any access tokens have been left out.
        </p>
        {error && <p className="setting-error">{error}</p>}
        <textarea
          className="report-text"
          readOnly
          aria-label="The report"
          value={report ?? 'Gathering…'}
          spellCheck={false}
        />
        <div className="report-actions">
          <button className="text-button" onClick={() => void vaultClient.showLogs().catch(() => {})}>
            Show logs folder
          </button>
          <span className="toolbar-spacer" />
          <button className="text-button" onClick={copy} disabled={!report}>
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button ref={closeRef} className="text-button" onClick={onClose}>
            Close
          </button>
          <button
            className="primary-button"
            disabled={!report}
            onClick={() => report && void vaultClient.openExternal(issueUrl(report)).then(onClose)}
          >
            Open GitHub issue
          </button>
        </div>
      </div>
    </div>
  )
}
