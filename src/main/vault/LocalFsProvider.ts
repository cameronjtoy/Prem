import { randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { watch, type FSWatcher } from 'chokidar'
import { VaultError } from '@shared/errors'
import { isMarkdown } from '@shared/paths'
import type {
  EntryKind,
  FileRecord,
  VaultChange,
  VaultEntry,
  VaultPath,
  WriteOptions,
  WriteResult
} from '@shared/types'
import { assertRealPathInside, resolveInsideVault, toVaultPath } from './safePath'
import type { VaultProvider } from './VaultProvider'

const IGNORED_NAMES = new Set(['node_modules'])
const isIgnoredName = (name: string): boolean => name.startsWith('.') || IGNORED_NAMES.has(name)
const TRASH_FOLDER = '.trash'
const SELF_WRITE_TTL_MS = 3000
const BATCH_MS = 100

function versionOf(stat: { mtimeMs: number; size: number }): string {
  return `${Math.floor(stat.mtimeMs)}-${stat.size}`
}

function wrapFsError(err: unknown, relPath: string): never {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') throw new VaultError('NOT_FOUND', `Not found: ${relPath}`)
  if (code === 'EEXIST') throw new VaultError('EXISTS', `Already exists: ${relPath}`)
  throw err
}

export interface LocalFsOptions {
  /** Where deleted files go. Defaults to a hidden `.trash` folder inside the vault. */
  trash?: (abs: string) => Promise<void>
}

/** A vault stored as a folder of markdown files on the local disk. */
export class LocalFsProvider implements VaultProvider {
  readonly name: string
  private watcher: FSWatcher | null = null
  /** Versions produced by our own writes, so the watcher can ignore their echo. */
  private selfWrites = new Map<VaultPath, string>()
  private readonly trash: (abs: string) => Promise<void>

  /** `root` must be a real (symlink-resolved) absolute path. */
  constructor(
    readonly root: string,
    options: LocalFsOptions = {}
  ) {
    this.name = path.basename(root)
    this.trash = options.trash ?? ((abs) => this.moveToVaultTrash(abs))
  }

  private async moveToVaultTrash(abs: string): Promise<void> {
    const dir = path.join(this.root, TRASH_FOLDER)
    await fs.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await fs.rename(abs, path.join(dir, `${stamp}-${randomBytes(3).toString('hex')} ${path.basename(abs)}`))
  }

  private async abs(relPath: string): Promise<string> {
    const abs = resolveInsideVault(this.root, relPath)
    await assertRealPathInside(this.root, abs)
    return abs
  }

  async list(): Promise<VaultEntry[]> {
    const entries: VaultEntry[] = []
    const walk = async (dirAbs: string): Promise<void> => {
      const dirents = await fs.readdir(dirAbs, { withFileTypes: true })
      for (const d of dirents) {
        if (isIgnoredName(d.name)) continue
        const abs = path.join(dirAbs, d.name)
        if (d.isDirectory()) {
          entries.push({ path: toVaultPath(this.root, abs), kind: 'folder' })
          await walk(abs)
        } else if (d.isFile()) {
          entries.push({ path: toVaultPath(this.root, abs), kind: 'file' })
        }
      }
    }
    await walk(this.root)
    return entries
  }

  async read(relPath: VaultPath): Promise<FileRecord> {
    const abs = await this.abs(relPath)
    try {
      const [content, stat] = await Promise.all([fs.readFile(abs, 'utf8'), fs.stat(abs)])
      return { path: relPath, content, version: versionOf(stat) }
    } catch (err) {
      wrapFsError(err, relPath)
    }
  }

  async readAllMarkdown(): Promise<FileRecord[]> {
    const files = (await this.list()).filter((e) => e.kind === 'file' && isMarkdown(e.path))
    const records: FileRecord[] = []
    for (let i = 0; i < files.length; i += 32) {
      const batch = await Promise.allSettled(files.slice(i, i + 32).map((f) => this.read(f.path)))
      for (const r of batch) if (r.status === 'fulfilled') records.push(r.value)
    }
    return records
  }

  async write(relPath: VaultPath, content: string, options: WriteOptions = {}): Promise<WriteResult> {
    if (!isMarkdown(relPath)) throw new VaultError('INVALID_PATH', 'Only .md files can be written as notes')
    return this.writeFile(relPath, content, options)
  }

  async readBinary(relPath: VaultPath): Promise<Uint8Array> {
    const abs = await this.abs(relPath)
    try {
      return new Uint8Array(await fs.readFile(abs))
    } catch (err) {
      wrapFsError(err, relPath)
    }
  }

  async writeBinary(relPath: VaultPath, data: Uint8Array, options: WriteOptions = {}): Promise<WriteResult> {
    if (isMarkdown(relPath)) throw new VaultError('INVALID_PATH', 'Notes must be saved as text')
    return this.writeFile(relPath, data, options)
  }

  /** The file's location on disk, for handing it to the operating system. Checked like any other access. */
  absolutePath(relPath: VaultPath): Promise<string> {
    return this.abs(relPath)
  }

  private async writeFile(relPath: VaultPath, content: string | Uint8Array, options: WriteOptions): Promise<WriteResult> {
    const abs = await this.abs(relPath)
    const current = await fs.stat(abs).catch(() => null)
    if (options.createOnly && current) throw new VaultError('EXISTS', `Already exists: ${relPath}`)
    if (options.expectedVersion && current && versionOf(current) !== options.expectedVersion) {
      throw new VaultError('CONFLICT', `${relPath} was changed outside the app`)
    }

    await fs.mkdir(path.dirname(abs), { recursive: true })
    const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(4).toString('hex')}.tmp`)
    try {
      await fs.writeFile(tmp, content)
      await fs.rename(tmp, abs)
    } catch (err) {
      await fs.rm(tmp, { force: true })
      throw err
    }
    const version = versionOf(await fs.stat(abs))
    this.selfWrites.set(relPath, version)
    setTimeout(() => {
      if (this.selfWrites.get(relPath) === version) this.selfWrites.delete(relPath)
    }, SELF_WRITE_TTL_MS)
    return { version }
  }

  async mkdir(relPath: VaultPath): Promise<void> {
    const abs = await this.abs(relPath)
    try {
      await fs.mkdir(abs)
    } catch (err) {
      wrapFsError(err, relPath)
    }
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    const [fromAbs, toAbs] = await Promise.all([this.abs(from), this.abs(to)])
    if (fromAbs === toAbs) return
    // Allow case-only renames on case-insensitive disks, where the target "exists" as the source.
    const caseOnly = fromAbs.toLowerCase() === toAbs.toLowerCase()
    if (!caseOnly && (await this.existsAbs(toAbs))) throw new VaultError('EXISTS', `Already exists: ${to}`)
    await fs.mkdir(path.dirname(toAbs), { recursive: true })
    try {
      await fs.rename(fromAbs, toAbs)
    } catch (err) {
      wrapFsError(err, from)
    }
  }

  async remove(relPath: VaultPath): Promise<void> {
    if (!relPath) throw new VaultError('INVALID_PATH', 'Cannot delete the vault root')
    const abs = await this.abs(relPath)
    if (!(await this.existsAbs(abs))) throw new VaultError('NOT_FOUND', `Not found: ${relPath}`)
    await this.trash(abs)
  }

  async exists(relPath: VaultPath): Promise<boolean> {
    return this.existsAbs(await this.abs(relPath))
  }

  private async existsAbs(abs: string): Promise<boolean> {
    return fs.access(abs, constants.F_OK).then(
      () => true,
      () => false
    )
  }

  watch(listener: (changes: VaultChange[]) => void): () => void {
    let pending: VaultChange[] = []
    let timer: NodeJS.Timeout | null = null
    const flush = (): void => {
      timer = null
      const batch = pending
      pending = []
      if (batch.length) listener(batch)
    }
    const push = (change: VaultChange): void => {
      pending.push(change)
      timer ??= setTimeout(flush, BATCH_MS)
    }

    const onEvent = async (type: VaultChange['type'], kind: EntryKind, abs: string): Promise<void> => {
      const rel = toVaultPath(this.root, abs)
      if (!rel) return
      if (type === 'modified') {
        const own = this.selfWrites.get(rel)
        if (own) {
          const stat = await fs.stat(abs).catch(() => null)
          if (stat && versionOf(stat) === own) return
        }
      }
      push({ type, path: rel, kind } as VaultChange)
    }

    const watcher = watch(this.root, {
      ignoreInitial: true,
      ignored: (p: string) => p !== this.root && isIgnoredName(path.basename(p)),
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    watcher
      .on('add', (p) => void onEvent('created', 'file', p))
      .on('change', (p) => void onEvent('modified', 'file', p))
      .on('unlink', (p) => void onEvent('deleted', 'file', p))
      .on('addDir', (p) => void onEvent('created', 'folder', p))
      .on('unlinkDir', (p) => void onEvent('deleted', 'folder', p))
      .on('error', (err) => console.error('[watcher]', err))
    this.watcher = watcher

    return () => {
      if (timer) clearTimeout(timer)
      void watcher.close()
      if (this.watcher === watcher) this.watcher = null
    }
  }

  async dispose(): Promise<void> {
    await this.watcher?.close()
    this.watcher = null
  }
}
