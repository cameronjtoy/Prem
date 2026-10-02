import { watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  DEFAULTS,
  syntaxErrorLocation,
  validate,
  withSetting,
  type SettingKey,
  type Settings,
  type SettingsSnapshot
} from '@shared/settings/schema'
import { VaultError } from '@shared/vault/errors'

const WATCH_DEBOUNCE_MS = 100

/**
 * The person's settings.json. It holds only what they changed; everything else is a default. Edits made in
 * another editor apply as soon as the file is saved. If the file can't be read, the last good settings stay
 * in use and the snapshot says what's wrong.
 */
export class SettingsStore {
  private snapshot: SettingsSnapshot
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  constructor(
    readonly file: string,
    private readonly onChange: (snapshot: SettingsSnapshot) => void = () => {}
  ) {
    this.snapshot = { values: DEFAULTS, problems: [], error: null, file }
  }

  get current(): SettingsSnapshot {
    return this.snapshot
  }

  get values(): Settings {
    return this.snapshot.values
  }

  /** Reads the file again. Tells the listener only if something the app shows changed. */
  async load(): Promise<SettingsSnapshot> {
    const text = await this.readText()
    let next: SettingsSnapshot
    if (text === null || !text.trim()) {
      next = { values: DEFAULTS, problems: [], error: null, file: this.file }
    } else {
      try {
        next = { ...validate(JSON.parse(text)), error: null, file: this.file }
      } catch (err) {
        next = { ...this.snapshot, error: syntaxErrorLocation(text, err) }
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.snapshot)
    this.snapshot = next
    if (changed) this.onChange(next)
    return next
  }

  /** Changes one setting and saves the file. Refuses while the file has a syntax error, so nothing is lost. */
  async set(key: SettingKey, value: unknown): Promise<SettingsSnapshot> {
    const text = await this.readText()
    let raw: unknown = {}
    if (text?.trim()) {
      try {
        raw = JSON.parse(text)
      } catch (err) {
        throw new VaultError(
          'INVALID_ARGUMENT',
          `settings.json has a mistake at ${syntaxErrorLocation(text, err)}. Fix it, then try again.`
        )
      }
    }
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) raw = {}
    let next: Record<string, unknown>
    try {
      next = withSetting(raw as Record<string, unknown>, key, value)
    } catch (err) {
      throw new VaultError('INVALID_ARGUMENT', err instanceof Error ? err.message : String(err))
    }
    await writeFile(this.file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return this.load()
  }

  /** Makes sure the file exists, so it can be opened in an editor. */
  async ensureFile(): Promise<string> {
    if ((await this.readText()) === null) await writeFile(this.file, '{\n}\n', 'utf8')
    return this.file
  }

  /** Watches the folder rather than the file, so editors that save by replacing the file are seen too. */
  watch(): void {
    if (this.watcher) return
    const name = path.basename(this.file)
    try {
      this.watcher = watch(path.dirname(this.file), (_event, changed) => {
        if (changed && changed.toString() !== name) return
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => void this.load(), WATCH_DEBOUNCE_MS)
      })
      this.watcher.on('error', () => this.close())
    } catch {
      // Not every file system can be watched. Settings still apply when changed in the app.
    }
  }

  close(): void {
    if (this.timer) clearTimeout(this.timer)
    this.watcher?.close()
    this.watcher = null
  }

  private async readText(): Promise<string | null> {
    try {
      return await readFile(this.file, 'utf8')
    } catch {
      return null
    }
  }
}
