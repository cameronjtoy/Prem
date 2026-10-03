import { watch, type FSWatcher } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { syntaxErrorLocation } from '@shared/settings/schema'
import { VaultError } from '@shared/vault/errors'

const WATCH_DEBOUNCE_MS = 100

export interface FileSnapshot {
  problems: string[]
  error: string | null
  file: string
}

/**
 * A JSON file people may edit by hand, such as settings.json. Edits made in another editor apply as soon as
 * the file is saved. If it can't be read as JSON, the last good snapshot stays in use and says what's wrong.
 */
export class WatchedJsonFile<S extends FileSnapshot> {
  private snapshot: S
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null

  /**
   * @param interpret turns the parsed file (or `undefined` when there is none) into a snapshot
   * @param empty what a new file contains
   */
  constructor(
    readonly file: string,
    private readonly interpret: (raw: unknown) => Omit<S, 'error' | 'file'>,
    private readonly empty: string,
    private readonly onChange: (snapshot: S) => void = () => {}
  ) {
    this.snapshot = { ...interpret(undefined), error: null, file } as S
  }

  get current(): S {
    return this.snapshot
  }

  /** Reads the file again. Tells the listener only if something changed. */
  async load(): Promise<S> {
    const text = await this.readText()
    let next: S
    if (text === null || !text.trim()) {
      next = { ...this.interpret(undefined), error: null, file: this.file } as S
    } else {
      try {
        next = { ...this.interpret(JSON.parse(text)), error: null, file: this.file } as S
      } catch (err) {
        next = { ...this.snapshot, error: syntaxErrorLocation(text, err) }
      }
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.snapshot)
    this.snapshot = next
    if (changed) this.onChange(next)
    return next
  }

  /**
   * Rewrites the file from its parsed contents (`undefined` when there is none). Refuses while the file has
   * a syntax error, so nothing the person wrote is lost.
   */
  async update(change: (raw: unknown) => unknown): Promise<S> {
    const text = await this.readText()
    let raw: unknown
    if (text?.trim()) {
      try {
        raw = JSON.parse(text)
      } catch (err) {
        const name = path.basename(this.file)
        throw new VaultError(
          'INVALID_ARGUMENT',
          `${name} has a mistake at ${syntaxErrorLocation(text, err)}. Fix it, then try again.`
        )
      }
    }
    let next: unknown
    try {
      next = change(raw)
    } catch (err) {
      throw new VaultError('INVALID_ARGUMENT', err instanceof Error ? err.message : String(err))
    }
    await writeFile(this.file, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    return this.load()
  }

  /** Makes sure the file exists, so it can be opened in an editor. */
  async ensureFile(): Promise<string> {
    if ((await this.readText()) === null) await writeFile(this.file, this.empty, 'utf8')
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
      // Not every file system can be watched. Changes made in the app still apply.
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
