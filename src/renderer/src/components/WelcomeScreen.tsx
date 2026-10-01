import { useState, type FormEvent } from 'react'
import { useVault } from '../state/VaultContext'
import { VaultIcon } from './icons'

export function WelcomeScreen() {
  const { openVault, connectServer, starting, error } = useVault()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [connecting, setConnecting] = useState(false)
  if (starting) return <div className="welcome" />

  const onConnect = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setConnecting(true)
    await connectServer(url, token)
    setConnecting(false)
  }

  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Prem</h1>
        <p>A shared home for your team's knowledge: reference notes, formulas and runbooks, all linked together.</p>
        <button className="primary-button" onClick={() => void openVault()}>
          <VaultIcon /> Open a folder as a vault
        </button>
        <p className="hint">
          Pick any folder. Notes are saved there as plain markdown files, so you can also open them in other editors.
        </p>

        <form className="connect-form" onSubmit={(e) => void onConnect(e)}>
          <h2>Or join your team's vault</h2>
          <input
            className="text-input"
            placeholder="Server address, e.g. https://prem.example.com"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            autoComplete="url"
            spellCheck={false}
          />
          <input
            className="text-input"
            type="password"
            placeholder="Access token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
          />
          <button className="text-button" type="submit" disabled={connecting || !url.trim() || !token.trim()}>
            {connecting ? 'Connecting…' : 'Connect'}
          </button>
        </form>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
