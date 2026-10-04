import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { VaultError } from '@shared/vault/errors'
import { PREM_FOLDER, type HistoryEntry } from '@shared/records/history'
import { applyEntry, EMPTY_STATUS, recordStatus, type RecordStatus } from '@shared/records/signatures'
import type { VaultPath } from '@shared/vault/types'
import { resolveInsideVault } from './safePath'

const sha256 = (data: string | Buffer): string => createHash('sha256').update(data).digest('hex')

/** The id covers every other field, in a fixed order, so the same entry always hashes the same way. */
function entryId(e: Omit<HistoryEntry, 'id'>): string {
  // `reason` is only included when present, so entries written before it existed keep their ids.
  const fields: unknown[] = [e.n, e.time, e.author, e.kind, e.hash, e.size, e.from ?? null, e.prev]
  if (e.reason !== undefined) fields.push(e.reason)
  return sha256(JSON.stringify(fields))
}

export function contentHash(content: string): string {
  return sha256(content)
}

export interface ChainCheck {
  ok: boolean
  /** The first entry that doesn't match, if any. */
  brokenAt?: number
}

/**
 * Keeps every version of every note in the vault's hidden `.prem` folder:
 * - `.prem/history/<note path>.jsonl` is the note's append-only, hash-chained log;
 * - `.prem/objects/ab/abcd….gz` holds each distinct version's content, compressed and shared between notes.
 */
export class NoteHistory {
  private readonly logsDir: string
  private readonly objectsDir: string
  /** Appends to one log run one after another, so entries never interleave or skip a number. */
  private queues = new Map<string, Promise<unknown>>()
  private lastEntries = new Map<string, HistoryEntry | null>()
  private statuses = new Map<string, RecordStatus>()

  constructor(root: string) {
    this.logsDir = path.join(root, PREM_FOLDER, 'history')
    this.objectsDir = path.join(root, PREM_FOLDER, 'objects')
  }

  private logFile(notePath: VaultPath): string {
    return resolveInsideVault(this.logsDir, `${notePath}.jsonl`)
  }

  private serial<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(key) ?? Promise.resolve()).then(fn, fn)
    const tail = run.catch(() => undefined)
    this.queues.set(key, tail)
    void tail.then(() => this.queues.get(key) === tail && this.queues.delete(key))
    return run
  }

  async list(notePath: VaultPath): Promise<HistoryEntry[]> {
    let text: string
    try {
      text = await fs.readFile(this.logFile(notePath), 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw err
    }
    return text
      .split('\n')
      .filter((line) => line.trim())
      .map((line) => JSON.parse(line) as HistoryEntry)
  }

  /** The latest entry of a note's history, or null if it has none. */
  latest(notePath: VaultPath): Promise<HistoryEntry | null> {
    return this.serial(notePath.toLowerCase(), () => this.last(notePath))
  }

  private async last(notePath: VaultPath): Promise<HistoryEntry | null> {
    const key = notePath.toLowerCase()
    if (!this.lastEntries.has(key)) {
      const entries = await this.list(notePath)
      this.lastEntries.set(key, entries[entries.length - 1] ?? null)
    }
    return this.lastEntries.get(key) ?? null
  }

  private async append(
    notePath: VaultPath,
    fields: Omit<HistoryEntry, 'n' | 'prev' | 'id' | 'time'>
  ): Promise<HistoryEntry> {
    const prev = await this.last(notePath)
    const base = { n: (prev?.n ?? 0) + 1, time: new Date().toISOString(), ...fields, prev: prev?.id ?? '' }
    const entry: HistoryEntry = { ...base, id: entryId(base) }
    const file = this.logFile(notePath)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.appendFile(file, JSON.stringify(entry) + '\n', 'utf8')
    const key = notePath.toLowerCase()
    this.lastEntries.set(key, entry)
    const cached = this.statuses.get(key)
    if (cached) this.statuses.set(key, applyEntry(cached, entry))
    return entry
  }

  private async storeObject(content: string): Promise<string> {
    const hash = sha256(content)
    const file = path.join(this.objectsDir, hash.slice(0, 2), `${hash}.gz`)
    try {
      await fs.access(file)
    } catch {
      await fs.mkdir(path.dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
      await fs.writeFile(tmp, gzipSync(Buffer.from(content, 'utf8')))
      await fs.rename(tmp, file)
    }
    return hash
  }

  /** Records a version. Nothing is added if the content is the same as the latest version, e.g. an echo of our own save. */
  record(
    notePath: VaultPath,
    content: string,
    author: string,
    kind: 'save' | 'external' | 'amended',
    reason?: string
  ): Promise<HistoryEntry | null> {
    return this.serial(notePath.toLowerCase(), async () => {
      const hash = await this.storeObject(content)
      const prev = await this.last(notePath)
      if (prev && prev.hash === hash && prev.kind !== 'deleted') return null
      return this.append(notePath, { author, kind, hash, size: Buffer.byteLength(content, 'utf8'), reason })
    })
  }

  /** A note's signing status, worked out from its log once and then kept up to date as entries are added. */
  async status(notePath: VaultPath): Promise<RecordStatus> {
    const key = notePath.toLowerCase()
    const cached = this.statuses.get(key)
    if (cached) return cached
    const status = (await this.list(notePath)).length ? recordStatus(await this.list(notePath)) : EMPTY_STATUS
    this.statuses.set(key, status)
    return status
  }

  /**
   * Signs the note's latest version. `currentHash` is the content on disk now; signing is refused if
   * it isn't the latest recorded version, so what's signed is exactly what the signer is looking at.
   */
  sign(notePath: VaultPath, author: string, currentHash: string, statement?: string): Promise<HistoryEntry> {
    return this.serial(notePath.toLowerCase(), async () => {
      const prev = await this.last(notePath)
      const status = await this.status(notePath)
      if (!prev || prev.kind === 'deleted') throw new VaultError('NOT_FOUND', `${notePath} has nothing to sign yet`)
      if (prev.hash !== currentHash)
        throw new VaultError('CONFLICT', `${notePath} has changes that aren't recorded yet; save and try again`)
      if (status.locked) throw new VaultError('LOCKED', `${notePath} is already signed`)
      return this.append(notePath, {
        author,
        kind: 'signed',
        hash: prev.hash,
        size: prev.size,
        reason: statement || undefined
      })
    })
  }

  /** Countersigns a signed note. The signer can't witness their own signature, and nobody witnesses twice. */
  witness(notePath: VaultPath, author: string): Promise<HistoryEntry> {
    return this.serial(notePath.toLowerCase(), async () => {
      const status = await this.status(notePath)
      if (!status.locked || !status.signature) throw new VaultError('INVALID_ARGUMENT', `${notePath} isn't signed yet`)
      if (status.changedOutside)
        throw new VaultError('CONFLICT', `${notePath} was changed outside Prem after it was signed`)
      if (!author) throw new VaultError('INVALID_ARGUMENT', 'Witnessing needs a named person')
      if (status.signature.by === author)
        throw new VaultError('INVALID_ARGUMENT', "You can't witness your own signature")
      if (status.witnesses.some((w) => w.by === author))
        throw new VaultError('EXISTS', `${author} has already witnessed ${notePath}`)
      const prev = (await this.last(notePath))!
      return this.append(notePath, { author, kind: 'witnessed', hash: prev.hash, size: prev.size })
    })
  }

  /**
   * Records what's on disk if it isn't the latest recorded version: a note that existed before Prem
   * kept history, or one edited while Prem wasn't running. Called before saving, signing and checking
   * a note, so no version is ever skipped and a signed note changed behind Prem's back is caught.
   */
  catchUp(notePath: VaultPath, readCurrent: () => Promise<string | null>): Promise<void> {
    return this.serial(notePath.toLowerCase(), async () => {
      const content = await readCurrent()
      if (content === null) return
      const prev = await this.last(notePath)
      if (prev && prev.kind !== 'deleted' && prev.hash === sha256(content)) return
      const hash = await this.storeObject(content)
      await this.append(notePath, { author: '', kind: 'external', hash, size: Buffer.byteLength(content, 'utf8') })
    })
  }

  recordDeleted(notePath: VaultPath, author: string): Promise<HistoryEntry | null> {
    return this.serial(notePath.toLowerCase(), async () => {
      const prev = await this.last(notePath)
      if (!prev || prev.kind === 'deleted') return null
      return this.append(notePath, { author, kind: 'deleted', hash: '', size: 0 })
    })
  }

  /** Moves a note's log to its new path and notes the rename in it, so its history follows it. */
  async recordRenamed(from: VaultPath, to: VaultPath, author: string): Promise<void> {
    const src = this.logFile(from)
    const dest = this.logFile(to)
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true })
      await fs.rename(src, dest)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      throw err
    }
    for (const key of [from.toLowerCase(), to.toLowerCase()]) {
      this.lastEntries.delete(key)
      this.statuses.delete(key)
    }
    await this.serial(to.toLowerCase(), async () => {
      const prev = await this.last(to)
      if (prev) await this.append(to, { author, kind: 'renamed', hash: prev.hash, size: prev.size, from })
    })
  }

  /** The note paths with a history log under a folder, for renaming or deleting a whole folder. */
  async notesUnder(folder: VaultPath): Promise<VaultPath[]> {
    const dir = resolveInsideVault(this.logsDir, folder)
    const found: VaultPath[] = []
    const walk = async (abs: string): Promise<void> => {
      let items
      try {
        items = await fs.readdir(abs, { withFileTypes: true })
      } catch {
        return
      }
      for (const d of items) {
        const child = path.join(abs, d.name)
        if (d.isDirectory()) await walk(child)
        else if (d.name.endsWith('.jsonl'))
          found.push(path.relative(this.logsDir, child).split(path.sep).join('/').slice(0, -6))
      }
    }
    await walk(dir)
    return found
  }

  /** The content of a past version. */
  async read(notePath: VaultPath, id: string): Promise<string> {
    const entry = (await this.list(notePath)).find((e) => e.id === id)
    if (!entry || !entry.hash) throw new VaultError('NOT_FOUND', `No such version of ${notePath}`)
    const file = path.join(this.objectsDir, entry.hash.slice(0, 2), `${entry.hash}.gz`)
    const content = gunzipSync(await fs.readFile(file)).toString('utf8')
    if (sha256(content) !== entry.hash)
      throw new VaultError('UNKNOWN', `The stored copy of this version of ${notePath} is damaged`)
    return content
  }

  /** Checks that no entry in a note's log was changed, removed or reordered after it was written. */
  async verify(notePath: VaultPath): Promise<ChainCheck> {
    let prev = ''
    for (const [i, e] of (await this.list(notePath)).entries()) {
      const { id, ...rest } = e
      if (e.n !== i + 1 || e.prev !== prev || entryId(rest) !== id) return { ok: false, brokenAt: i + 1 }
      prev = id
    }
    return { ok: true }
  }
}
