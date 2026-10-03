import { useCallback, useEffect, useState } from 'react'
import type { AnalysisStatus } from '@shared/analysis/environment'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { useSettings } from '../../state/SettingsContext'

/** Which Python Prem found, and the state of the open vault's environment, with a button to set it up. */
export function PythonStatus() {
  const pythonSetting = useSettings().values['analysis.python']
  const [status, setStatus] = useState<AnalysisStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback((refresh: boolean) => {
    setError(null)
    vaultClient
      .analysisStatus(refresh)
      .then(setStatus)
      .catch((e) => setError(errorMessage(e)))
  }, [])

  useEffect(() => check(false), [check, pythonSetting])
  useEffect(() => vaultClient.onAnalysisProgress(setProgress), [])

  const prepare = (): void => {
    setBusy(true)
    setError(null)
    vaultClient
      .prepareAnalysis()
      .then(setStatus)
      .catch((e) => setError(errorMessage(e)))
      .finally(() => {
        setBusy(false)
        setProgress(null)
      })
  }

  const python = status?.python
  const env = status?.environment
  return (
    <div className="setting-row python-status" data-setting="analysis.status">
      <div className="setting-text">
        <span className="setting-title">Python on this computer</span>
        {!status && !error && <p className="setting-description">Looking for Python…</p>}
        {python && (
          <p className="setting-description">
            {python.python
              ? `Python ${python.version} (${python.python})${python.source === 'uv' ? ', managed by uv' : ''}`
              : python.problem}
            {python.uv && python.source !== 'uv' && python.python ? '. Environments are built with uv.' : ''}
          </p>
        )}
        {env && status && (
          <p className="setting-description env-state">
            {env.state === 'ready' &&
              `This vault's environment is ready: Python ${env.stamp.pythonVersion}, ${
                env.stamp.packages ? env.stamp.packages.split('\n').length : 0
              } packages (environment ${env.stamp.id}).`}
            {(env.state === 'missing' || env.state === 'outdated') &&
              (status.requirements
                ? env.state === 'outdated'
                  ? 'environment.txt changed since the environment was built. It is rebuilt before the next run, or now.'
                  : "This vault's environment.txt hasn't been set up on this computer yet."
                : 'This vault has no environment.txt, so cells run in the Python above with whatever it has installed.')}
          </p>
        )}
        {busy && <p className="setting-description">{progress ?? 'Setting up…'}</p>}
        {error && <p className="setting-error">{error}</p>}
      </div>
      <div className="setting-control">
        {status?.requirements && env?.state !== 'ready' && python?.python && (
          <button className="primary-button" onClick={prepare} disabled={busy}>
            {busy ? 'Setting up…' : 'Set up environment'}
          </button>
        )}
        <button className="text-button" onClick={() => check(true)} disabled={busy}>
          Look again
        </button>
      </div>
    </div>
  )
}
