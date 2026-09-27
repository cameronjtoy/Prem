import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'

interface Settings {
  lastVault?: string
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
