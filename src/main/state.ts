import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, safeStorage } from 'electron'

/** What Prem remembers between launches. People don't edit this; their choices live in settings.json. */
interface State {
  lastVault?: string
  /** The team server opened last. The token is encrypted with the OS keychain. */
  lastServer?: { url: string; token: string }
}

const STATE_KEYS = ['lastVault', 'lastServer'] as const

const stateFile = (): string => path.join(app.getPath('userData'), 'state.json')
const settingsFile = (): string => path.join(app.getPath('userData'), 'settings.json')

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = JSON.parse(await readFile(file, 'utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Earlier versions kept the last vault in settings.json. Moves it to state.json, so settings.json holds only
 * what people chose. Runs once, before settings are first read.
 */
export async function migrateState(): Promise<void> {
  const old = await readJson(settingsFile())
  if (!old || !STATE_KEYS.some((k) => k in old)) return
  const state = (await readJson(stateFile())) ?? {}
  const rest = { ...old }
  for (const key of STATE_KEYS) {
    if (key in old && !(key in state)) state[key] = old[key]
    delete rest[key]
  }
  await writeFile(stateFile(), JSON.stringify(state, null, 2), 'utf8')
  await writeFile(settingsFile(), `${JSON.stringify(rest, null, 2)}\n`, 'utf8')
}

export async function loadState(): Promise<State> {
  return ((await readJson(stateFile())) ?? {}) as State
}

export async function saveState(patch: Partial<State>): Promise<void> {
  const next = { ...(await loadState()), ...patch }
  await writeFile(stateFile(), JSON.stringify(next, null, 2), 'utf8')
}

/** Remembers a team server so it reopens on launch. Without OS encryption the token isn't saved, and you sign in again. */
export async function rememberServer(url: string, token: string): Promise<void> {
  const lastServer = safeStorage.isEncryptionAvailable()
    ? { url, token: safeStorage.encryptString(token).toString('base64') }
    : undefined
  await saveState({ lastServer, lastVault: undefined })
}

export function recallToken(saved: { token: string }): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(saved.token, 'base64'))
  } catch {
    return null
  }
}
