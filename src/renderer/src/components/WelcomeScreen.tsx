import { useVault } from '../state/VaultContext'
import { VaultIcon } from './icons'

export function WelcomeScreen() {
  const { openVault, starting, error } = useVault()
  if (starting) return <div className="welcome" />
  return (
    <div className="welcome">
      <div className="welcome-card">
        <h1>Prem</h1>
        <p>
          A shared home for your team's knowledge: reference notes, formulas and runbooks, all linked together.
        </p>
        <button className="primary-button" onClick={() => void openVault()}>
          <VaultIcon /> Open a folder as a vault
        </button>
        <p className="hint">
          Pick any folder. Notes are saved there as plain markdown files, so you can also open them in other editors.
        </p>
        {error && <p className="error-text">{error}</p>}
      </div>
    </div>
  )
}
