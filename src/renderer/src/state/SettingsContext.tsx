import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { notebookFolder } from '@shared/notes/notebook'
import { DEFAULTS, type SettingKey, type Settings, type SettingsSnapshot } from '@shared/settings/schema'
import { vaultClient } from '../services/vaultClient'

interface SettingsState {
  snapshot: SettingsSnapshot
  values: Settings
  /** Saves one setting to settings.json. Rejects with a message the person can read if it isn't allowed. */
  set(key: SettingKey, value: unknown): Promise<void>
  openFile(): Promise<void>
}

const EMPTY: SettingsSnapshot = { values: DEFAULTS, problems: [], error: null, file: '' }

const WIDTHS: Record<string, string> = { narrow: '640px', wide: '760px', full: 'none' }

// For code outside React (the editor session, inserted timestamps), which reads settings when it needs them.
let latest: Settings = DEFAULTS

export function currentSettings(): Settings {
  return latest
}

function applyToPage(values: Settings): void {
  const root = document.documentElement.style
  root.setProperty('--editor-width', WIDTHS[values['appearance.editorWidth']] ?? WIDTHS.wide)
  root.setProperty('--editor-font-size', `${values['appearance.textSize']}px`)
}

const SettingsContext = createContext<SettingsState | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<SettingsSnapshot>(EMPTY)

  useEffect(() => {
    const show = (next: SettingsSnapshot): void => {
      latest = next.values
      applyToPage(next.values)
      setSnapshot(next)
    }
    const off = vaultClient.onSettingsChanged(show)
    void vaultClient.getSettings().then(show)
    return off
  }, [])

  const set = useCallback(async (key: SettingKey, value: unknown) => {
    const next = await vaultClient.setSetting(key, value)
    latest = next.values
    applyToPage(next.values)
    setSnapshot(next)
  }, [])

  const value = useMemo<SettingsState>(
    () => ({ snapshot, values: snapshot.values, set, openFile: vaultClient.openSettingsFile }),
    [snapshot, set]
  )
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
}

export function useSettings(): SettingsState {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside SettingsProvider')
  return ctx
}

/** Where your notebook is: your own folder on a team vault, or the folder chosen in settings on a local one. */
export function useNotebookFolder(user: string | undefined): string {
  return notebookFolder(user, useSettings().values['notebook.folder'])
}
