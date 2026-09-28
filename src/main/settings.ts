import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'

interface Settings {
  lastVault?: string
  /** The team server opened last. The token is encrypted with the OS keychain. */
  lastServer?: { url: string; token: string }
}

const file = (): string => path.join(app.getPath('userData'), 'settings.json')

export async function loadSettings(): Promise<Settings> {
  try {
    return JSON.parse(await readFile(file(), 'utf8')) as Settings
  } catch {
    return {}
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const next = { ...(await loadSettings()), ...patch }
  await writeFile(file(), JSON.stringify(next, null, 2), 'utf8')
}

/** Remembers a team server so it reopens on launch. Without OS encryption the token isn't saved, and you sign in again. */
export async function rememberServer(url: string, token: string): Promise<void> {
  const lastServer = safeStorage.isEncryptionAvailable()
    ? { url, token: safeStorage.encryptString(token).toString('base64') }
    : undefined
  await saveSettings({ lastServer, lastVault: undefined })
}

export function recallToken(saved: { token: string }): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(saved.token, 'base64'))
  } catch {
    return null
  }
}
