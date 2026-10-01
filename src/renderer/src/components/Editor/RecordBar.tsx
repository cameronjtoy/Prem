import { useState, type FormEvent } from 'react'
import type { RecordCheck } from '@shared/records/signatures'
import { useVault } from '../../state/VaultContext'

/** Note types that are records someone signs off. Any note that's already been signed shows the bar too. */
const SIGNABLE = new Set(['experiment', 'run', 'daily', 'protocol'])

function when(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

type Form = { kind: 'sign' | 'amend'; text: string } | null

/**
 * Signing status for a note, with the actions the user may take: sign a draft (which locks it),
 * witness someone else's signature, or amend a signed note with a reason.
 */
export function RecordBar({
  path,
  type,
  status,
  amending,
  canEdit,
  onSign,
  onWitness,
  onAmend
}: {
  path: string
  type: string | null
  status: RecordCheck | null
  amending: string | null
  canEdit: boolean
  onSign(statement: string): Promise<void>
  onWitness(): Promise<void>
  onAmend(reason: string): void
}) {
  const { info } = useVault()
  const [form, setForm] = useState<Form>(null)
  const [busy, setBusy] = useState(false)

  if (!status) return null
  if (status.state === 'draft' && status.timesSigned === 0 && !SIGNABLE.has(type ?? '')) return null

  const me = info?.author ?? ''
  const canWitness =
    status.locked &&
    !!status.signature &&
    !!me &&
    status.signature.by !== me &&
    !status.witnesses.some((w) => w.by === me)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!form) return
    if (form.kind === 'amend') {
      if (!form.text.trim()) return
      onAmend(form.text.trim())
      setForm(null)
      return
    }
    setBusy(true)
    try {
      await onSign(form.text.trim())
      setForm(null)
    } finally {
      setBusy(false)
    }
  }

  const tone = !status.chainOk || status.changedOutside ? ' problem' : status.locked ? ' locked' : ''
  return (
    <div className={`record-bar${tone}`} data-path={path}>
      <div className="record-line">
        <span className="record-state">
          {status.locked ? '🔒 ' : ''}
          {status.state === 'draft' && 'Not signed'}
          {status.state === 'amended' && 'Amended, not signed again yet'}
          {status.signature && `Signed by ${status.signature.by || 'unknown'}`}
        </span>
        <span className="record-detail">
          {status.signature && when(status.signature.at)}
          {status.signature?.statement && ` · “${status.signature.statement}”`}
          {status.witnesses.map((w) => ` · Witnessed by ${w.by}, ${when(w.at)}`).join('')}
          {status.state === 'amended' &&
            status.amendment &&
            `${status.amendment.by}, ${when(status.amendment.at)}: ${status.amendment.reason}`}
        </span>
        {!form && !amending && (
          <span className="record-actions">
            {canEdit && !status.locked && (
              <button className="record-primary" onClick={() => setForm({ kind: 'sign', text: '' })}>
                Sign…
              </button>
            )}
            {canWitness && (
              <button
                className="record-primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true)
                  void onWitness().finally(() => setBusy(false))
                }}
              >
                Witness
              </button>
            )}
            {canEdit && status.locked && <button onClick={() => setForm({ kind: 'amend', text: '' })}>Amend…</button>}
          </span>
        )}
        {amending && (
          <span className="record-amending">Amending: {amending}. Your next change is recorded as an amendment.</span>
        )}
      </div>
      {!status.chainOk && (
        <div className="record-warning">
          This note's history has been altered outside Prem. Past versions and signatures can't be trusted.
        </div>
      )}
      {status.changedOutside && (
        <div className="record-warning">
          The file was changed outside Prem after it was signed. The signed version is kept in History.
        </div>
      )}
      {form && (
        <form className="record-form" onSubmit={(e) => void submit(e)}>
          {form.kind === 'sign' ? (
            <span className="hint">
              Signing records that this is your accurate record as it stands now, and locks it. Later changes need an
              amendment with a reason.
            </span>
          ) : (
            <span className="hint">
              Why does this signed record need to change? The reason is kept with the amendment.
            </span>
          )}
          <div className="record-form-row">
            <input
              autoFocus
              className="text-input"
              placeholder={
                form.kind === 'sign'
                  ? 'Optional statement, e.g. “Results reviewed”'
                  : 'Reason for the amendment (required)'
              }
              value={form.text}
              onChange={(e) => setForm({ ...form, text: e.target.value })}
              onKeyDown={(e) => e.key === 'Escape' && setForm(null)}
            />
            <button
              type="submit"
              className="record-primary"
              disabled={busy || (form.kind === 'amend' && !form.text.trim())}
            >
              {form.kind === 'sign' ? 'Sign and lock' : 'Unlock to amend'}
            </button>
            <button type="button" onClick={() => setForm(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
