import { mkdtemp, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { app, shell } from 'electron'
import {
  attachmentFileName,
  attachmentFolder,
  attachmentMarkdown,
  isSafeToOpen,
  MAX_ATTACHMENT_BYTES,
  numberedName
} from '@shared/attachments/attachments'
import { VaultError } from '@shared/vault/errors'
import type { HistoryEntry } from '@shared/records/history'
import type { RecordCheck } from '@shared/records/signatures'
import { LinkIndex } from '@shared/notes/linkIndex'
import { movesFor, relink } from '@shared/notes/relink'
import { createResolver } from '@shared/notes/resolve'
import { dailyNotePath, parseDay } from '@shared/notes/notebook'
import { basename, isMarkdown, isTemplate, joinPath, sanitizeFileName, TEMPLATES_FOLDER } from '@shared/vault/paths'
import { SearchIndex, type SearchHit } from '@shared/search/search'
import { renderTemplate } from '@shared/notes/templates'
import type {
  AddedAttachment,
  CreatedNote,
  IndexSummary,
  LinkIndexSnapshot,
  NoteLinks,
  RenameResult,
  TemplateInfo,
  VaultChange,
  VaultInfo,
  VaultPath,
  WriteOptions,
  WriteResult
} from '@shared/vault/types'
import { loadImages, loadPrintable, notesToPrint, printToPdf } from '../export/pdf'
import { printableHtml, type PrintableNote } from '../export/printable'
import { DEFAULTS, type Settings } from '@shared/settings/schema'
import { rememberServer, saveState } from '../state'
import { DAILY_TEMPLATE, DEFAULT_TEMPLATES } from './defaultTemplates'
import { backupVault } from './backup'
import { checkVaultFormat } from './format'
import { LocalFsProvider } from './LocalFsProvider'
import { RemoteProvider } from './RemoteProvider'
import type { VaultProvider } from './VaultProvider'
import serifFont from '@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?inline'

const WATCH_READY_MS = 5000
export interface VaultEvents {
  onChanged(changes: VaultChange[]): void
  onIndexUpdated(summary: IndexSummary): void
}

const INDEX_BROADCAST_MS = 150

/** Owns the open vault's provider and link index, and keeps the index in step with the disk. */
export class VaultManager {
  private provider: VaultProvider | null = null
  private index = new LinkIndex()
  /** Built from the same notes as the link index, so on a team vault it only ever holds notes you can read. */
  private search = new SearchIndex()
  private unwatch: (() => void) | null = null
  private broadcastTimer: NodeJS.Timeout | null = null
  /** Who's writing: the team server's name for you, or your login name for a local vault. */
  private author = ''
  /** Set for team vaults, where each person's notebook lives in its own folder. */
  private user: string | undefined

  constructor(
    private readonly events: VaultEvents,
    private readonly settings: () => Settings = () => DEFAULTS
  ) {}

  get isOpen(): boolean {
    return !!this.provider
  }

  /**
   * Zips the whole local vault, history included, into `file`. A team vault's backups are made on the server,
   * where the files are.
   */
  async backup(file: string): Promise<{ files: number; bytes: number }> {
    const provider = this.current
    if (!(provider instanceof LocalFsProvider)) {
      throw new VaultError(
        'INVALID_ARGUMENT',
        "A team vault is backed up on the lab server, where its files are. See 'Backups' in the lab server guide."
      )
    }
    return backupVault(provider.root, file)
  }

  /** Where the open vault is, and what kind it is, for problem reports (which leave the location out). */
  location(): { kind: 'local' | 'team server'; root: string } | null {
    if (!this.provider) return null
    return { kind: this.provider instanceof LocalFsProvider ? 'local' : 'team server', root: this.provider.root }
  }

  get current(): VaultProvider {
    if (!this.provider) throw new VaultError('NO_VAULT', 'No vault is open')
    return this.provider
  }

  async open(folder: string): Promise<VaultInfo> {
    const root = await realpath(folder)
    if (!(await stat(root)).isDirectory()) throw new VaultError('INVALID_PATH', 'Not a folder')
    await checkVaultFormat(root)
    const provider = new LocalFsProvider(root, { trash: (abs) => shell.trashItem(abs) })
    await this.seedTemplates(provider)
    await this.attach(provider)
    this.user = undefined
    this.author = localUserName()
    await saveState({ lastVault: root, lastServer: undefined })
    return { name: provider.name, root, author: this.author }
  }

  /** Opens a vault hosted by a team server. The server seeds templates and enforces who can see what. */
  async connect(url: string, token: string): Promise<VaultInfo> {
    const provider = await RemoteProvider.connect(url, token)
    await this.attach(provider)
    this.user = provider.user
    this.author = provider.user
    await rememberServer(provider.root, token)
    return {
      name: provider.name,
      root: provider.root,
      user: provider.user,
      author: provider.user,
      access: provider.access,
      role: provider.role
    }
  }

  private async attach(provider: VaultProvider): Promise<void> {
    const files = await provider.readAllMarkdown()
    const index = new LinkIndex()
    index.build(files)
    const search = new SearchIndex()
    search.build(files)
    await this.close()
    this.index = index
    this.search = search
    this.provider = provider
    this.unwatch = provider.watch((changes) => void this.handleChanges(changes))
    // Until the watcher has scanned the folder, edits made in other apps would go unnoticed. A very large
    // vault opens anyway after a few seconds; its watcher catches up in the background.
    let timer: NodeJS.Timeout | undefined
    await Promise.race([provider.watching?.(), new Promise((resolve) => (timer = setTimeout(resolve, WATCH_READY_MS)))])
    clearTimeout(timer)
  }

  async close(): Promise<void> {
    this.unwatch?.()
    this.unwatch = null
    await this.provider?.dispose()
    this.provider = null
  }

  find(query: string): SearchHit[] {
    return this.provider ? this.search.search(query) : []
  }

  /** The small summary the window is sent on every change. */
  summary(): IndexSummary | null {
    return this.provider ? this.index.summary() : null
  }

  /** The links into and out of one note, for the Links panel. */
  linksFor(path: VaultPath): NoteLinks | null {
    return this.provider ? this.index.linksFor(path) : null
  }

  /** Every note and link, for the graph view. */
  graph(): LinkIndexSnapshot['graph'] | null {
    return this.provider ? this.index.snapshot().graph : null
  }

  async write(path: VaultPath, content: string, options?: WriteOptions): Promise<WriteResult> {
    // Local vaults record the author themselves; a team server ignores this and uses who you signed in as.
    const result = await this.current.write(path, content, { ...options, author: this.author })
    // Our own writes are filtered out of the watcher, so update the index directly.
    this.index.upsert(path, content)
    this.search.upsert(path, content)
    this.scheduleBroadcast()
    return result
  }

  /** Moves a note, attachment or folder, then rewrites links to whatever moved so they keep working. */
  async rename(from: VaultPath, to: VaultPath): Promise<RenameResult> {
    const provider = this.current
    const filesBefore = (await provider.list()).filter((e) => e.kind === 'file').map((e) => e.path)
    await provider.rename(from, to, this.author)
    return this.relinkAfterMove(provider, movesFor(from, to, filesBefore), filesBefore)
  }

  private async relinkAfterMove(
    provider: VaultProvider,
    moves: Map<string, VaultPath>,
    filesBefore: VaultPath[]
  ): Promise<RenameResult> {
    const result: RenameResult = { updated: [], locked: [], readOnly: [] }
    if (!moves.size) return result
    const filesAfter = filesBefore.map((p) => moves.get(p.toLowerCase()) ?? p)
    const oldPathOf = new Map(filesBefore.map((p, i) => [filesAfter[i].toLowerCase(), p]))
    const shared = {
      moves,
      before: createResolver(filesBefore),
      after: createResolver(filesAfter),
      existed: new Set(filesBefore.map((p) => p.toLowerCase()))
    }
    for (const note of await provider.readAllMarkdown()) {
      const oldNotePath = oldPathOf.get(note.path.toLowerCase()) ?? note.path
      const next = relink(note.content, { ...shared, oldNotePath, notePath: note.path })
      if (next === note.content) continue
      try {
        await this.write(note.path, next, { expectedVersion: note.version })
        result.updated.push(note.path)
      } catch (err) {
        if (err instanceof VaultError && err.code === 'LOCKED') result.locked.push(note.path)
        else if (err instanceof VaultError && (err.code === 'FORBIDDEN' || err.code === 'CONFLICT'))
          result.readOnly.push(note.path)
        else throw err
      }
    }
    // Prem's own writes don't come back through the watcher, so tell open editors about these.
    if (result.updated.length)
      this.events.onChanged(result.updated.map((path) => ({ type: 'modified', path, kind: 'file' })))
    return result
  }

  remove(path: VaultPath): Promise<void> {
    return this.current.remove(path, this.author)
  }

  history(path: VaultPath): Promise<HistoryEntry[]> {
    return this.current.history(path)
  }

  readVersion(path: VaultPath, id: string): Promise<string> {
    return this.current.readVersion(path, id)
  }

  recordStatus(path: VaultPath): Promise<RecordCheck> {
    return this.current.recordStatus(path)
  }

  sign(path: VaultPath, statement?: string): Promise<RecordCheck> {
    return this.current.sign(path, this.author, statement)
  }

  witness(path: VaultPath): Promise<RecordCheck> {
    return this.current.witness(path, this.author)
  }

  /**
   * Prints a note, or every note in a folder, to a PDF with its metadata, signatures, witnesses,
   * amendments and the result of checking its history. `file` is where to save it.
   */
  async exportPdf(path: VaultPath, file: string): Promise<{ notes: number }> {
    const provider = this.current
    const paths = await notesToPrint(provider, path)
    const notes: PrintableNote[] = []
    for (const p of paths) notes.push(await loadPrintable(provider, p))
    const images = await loadImages(provider, notes)
    const html = printableHtml(notes, {
      vaultName: provider.name,
      exportedBy: this.author,
      exportedAt: new Date(),
      appVersion: app.getVersion(),
      embedImage: (p) => images.get(p) ?? null,
      pageSize: this.settings()['export.pageSize'] === 'Letter' ? 'Letter' : 'A4',
      headingFont: serifFont
    })
    const footer = notes.length === 1 ? notes[0].path : `${path || provider.name} · ${notes.length} entries`
    await printToPdf(html, file, footer)
    return { notes: notes.length }
  }

  async listTemplates(): Promise<TemplateInfo[]> {
    const entries = await this.current.list()
    return entries
      .filter((e) => e.kind === 'file' && isTemplate(e.path))
      .map((e) => ({ name: basename(e.path).slice(0, -3), path: e.path }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async createFromTemplate(templatePath: VaultPath, title: string, folder: VaultPath): Promise<CreatedNote> {
    const provider = this.current
    const source = templatePath ? (await provider.read(templatePath)).content : ''
    const baseName = sanitizeFileName(title)
    for (let n = 0; n < 1000; n++) {
      const name = n === 0 ? baseName : `${baseName} ${n}`
      const path = joinPath(folder, `${name}.md`)
      if (await provider.exists(path)) continue
      const { content, cursor } = renderTemplate(source, { title: name, author: this.author })
      try {
        await this.write(path, content, { createOnly: true })
        return { path, cursor }
      } catch (err) {
        if (!(err instanceof VaultError && err.code === 'EXISTS')) throw err
      }
    }
    throw new VaultError('EXISTS', `Could not find a free name for "${baseName}"`)
  }

  /** Copies a file into the note's attachments folder under a free name, and returns the markdown that shows it. */
  async addAttachment(notePath: VaultPath, fileName: string, data: Uint8Array): Promise<AddedAttachment> {
    if (data.byteLength > MAX_ATTACHMENT_BYTES) {
      throw new VaultError('INVALID_ARGUMENT', `"${fileName}" is larger than ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`)
    }
    const provider = this.current
    const folder = attachmentFolder(notePath)
    const name = attachmentFileName(fileName)
    for (let n = 0; n < 1000; n++) {
      const path = joinPath(folder, numberedName(name, n))
      try {
        await provider.writeBinary(path, data, { createOnly: true })
        return { path, markdown: attachmentMarkdown(notePath, path) }
      } catch (err) {
        if (!(err instanceof VaultError && err.code === 'EXISTS')) throw err
      }
    }
    throw new VaultError('EXISTS', `Could not find a free name for "${name}"`)
  }

  readBinary(path: VaultPath): Promise<Uint8Array> {
    return this.current.readBinary(path)
  }

  /**
   * Opens an attachment in its default app. Only known data formats are opened; anything else,
   * such as a script or installer, is shown in its folder instead so it can't run by accident.
   */
  async openFile(path: VaultPath): Promise<void> {
    const provider = this.current
    let file: string
    if (provider instanceof LocalFsProvider) {
      file = await provider.absolutePath(path)
    } else {
      // Team vault: download a copy. Edits to it aren't sent back; attach the changed file again instead.
      const dir = await mkdtemp(join(tmpdir(), 'prem-'))
      file = join(dir, basename(path))
      await writeFile(file, await provider.readBinary(path))
    }
    if (!isSafeToOpen(path)) return shell.showItemInFolder(file)
    const error = await shell.openPath(file)
    if (error) throw new VaultError('UNKNOWN', `Couldn't open ${basename(path)}: ${error}`)
  }

  /** Opens the daily entry for `day` (YYYY-MM-DD, in the user's own time zone), creating it on first use. */
  async openDaily(day: string): Promise<CreatedNote> {
    const provider = this.current
    const path = dailyNotePath(day, this.user, this.settings()['notebook.folder'])
    if (await provider.exists(path)) return { path, cursor: null }

    const custom = `${TEMPLATES_FOLDER}/${DAILY_TEMPLATE}`
    const source = (await provider.exists(custom))
      ? (await provider.read(custom)).content
      : DEFAULT_TEMPLATES[DAILY_TEMPLATE]
    // The entry is dated for the day asked for; {{time}} still means the time it was created.
    const now = new Date()
    const when = parseDay(day)
    when.setHours(now.getHours(), now.getMinutes())
    const { content, cursor } = renderTemplate(source, { title: day, now: when, author: this.author })
    try {
      await this.write(path, content, { createOnly: true })
      return { path, cursor }
    } catch (err) {
      // Created a moment ago, e.g. by the same person on another machine.
      if (err instanceof VaultError && err.code === 'EXISTS') return { path, cursor: null }
      throw err
    }
  }

  private async seedTemplates(provider: VaultProvider): Promise<void> {
    if (await provider.exists(TEMPLATES_FOLDER)) return
    await provider.mkdir(TEMPLATES_FOLDER)
    for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
      await provider.write(joinPath(TEMPLATES_FOLDER, name), content, { createOnly: true })
    }
  }

  private async handleChanges(changes: VaultChange[]): Promise<void> {
    const provider = this.provider
    if (!provider) return
    this.events.onChanged(changes)
    for (const change of changes) {
      if (change.kind === 'folder') {
        if (change.type === 'deleted') {
          this.index.removeFolder(change.path)
          this.search.removeFolder(change.path)
        }
        continue
      }
      if (!isMarkdown(change.path)) continue
      if (change.type === 'deleted') {
        this.index.remove(change.path)
        this.search.remove(change.path)
      } else {
        try {
          const { content } = await provider.read(change.path)
          this.index.upsert(change.path, content)
          this.search.upsert(change.path, content)
        } catch {
          this.index.remove(change.path)
          this.search.remove(change.path)
        }
      }
    }
    if (provider === this.provider) this.scheduleBroadcast()
  }

  private scheduleBroadcast(): void {
    if (this.broadcastTimer) return
    this.broadcastTimer = setTimeout(() => {
      this.broadcastTimer = null
      const summary = this.summary()
      if (summary) this.events.onIndexUpdated(summary)
    }, INDEX_BROADCAST_MS)
  }
}

function localUserName(): string {
  try {
    return userInfo().username
  } catch {
    return ''
  }
}
