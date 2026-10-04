import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { format } from 'node:util'

/** The log is rotated at this size, keeping this many older files: about 4 MB at most. */
const MAX_BYTES = 1024 * 1024
const KEEP = 3

function readLines(file: string): string[] {
  try {
    return readFileSync(file, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

/**
 * Prem's log: errors, warnings and a line at startup, in `<userData>/logs/main.log`. It stays on this computer;
 * Help → Report a problem shows its last lines so they can be shared, with private paths removed.
 */
export class LogFile {
  constructor(private readonly dir: string) {}

  get file(): string {
    return path.join(this.dir, 'main.log')
  }

  write(level: 'info' | 'warn' | 'error', message: string): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      this.rotate()
      const lines = message.replace(/\r?\n/g, '\n    ')
      appendFileSync(this.file, `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${lines}\n`, 'utf8')
    } catch {
      // Logging must never be the thing that breaks the app.
    }
  }

  /** The last `count` lines, oldest first, from this file and the one before it if needed. */
  tail(count: number): string[] {
    const lines = readLines(this.file)
    if (lines.length >= count) return lines.slice(-count)
    return [...readLines(`${this.file}.1`), ...lines].slice(-count)
  }

  private rotate(): void {
    if (!existsSync(this.file) || statSync(this.file).size < MAX_BYTES) return
    const oldest = `${this.file}.${KEEP}`
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let i = KEEP - 1; i >= 1; i--) {
      if (existsSync(`${this.file}.${i}`)) renameSync(`${this.file}.${i}`, `${this.file}.${i + 1}`)
    }
    renameSync(this.file, `${this.file}.1`)
  }
}

/** Sends the main process's warnings, errors and crashes to the log as well as the console. */
export function captureConsole(log: LogFile): void {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...args: unknown[]) => {
      log.write(level, format(...args))
      original(...args)
    }
  }
  process.on('uncaughtException', (err) => log.write('error', `Uncaught: ${err.stack ?? err}`))
  process.on('unhandledRejection', (reason) =>
    log.write('error', `Unhandled rejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : reason}`)
  )
}
