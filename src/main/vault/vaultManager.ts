import { mkdtemp, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { shell } from 'electron'
import {
  attachmentFileName,
  attachmentFolder,
  attachmentMarkdown,
  isSafeToOpen,
  MAX_ATTACHMENT_BYTES,
  numberedName
} from '@shared/attachments'
import { VaultError } from '@shared/errors'
import type { HistoryEntry } from '@shared/history'
import { LinkIndex } from '@shared/linkIndex'
import { dailyNotePath, parseDay } from '@shared/notebook'
import {
  basename,
  isMarkdown,
  isTemplate,
  joinPath,
  sanitizeFileName,
  TEMPLATES_FOLDER
} from '@shared/paths'
import { SearchIndex, type SearchHit } from '@shared/search'
import { renderTemplate } from '@shared/templates'
import type {
  AddedAttachment,
  CreatedNote,
  LinkIndexSnapshot,
  TemplateInfo,
  VaultChange,
  VaultInfo,
  VaultPath,
  WriteOptions,
  WriteResult
} from '@shared/types'
import { rememberServer, saveSettings } from '../settings'
import { DAILY_TEMPLATE, DEFAULT_TEMPLATES } from './defaultTemplates'
import { LocalFsProvider } from './LocalFsProvider'
import { RemoteProvider } from './RemoteProvider'
import type { VaultProvider } from './VaultProvider'

export interface VaultEvents {
  onChanged(changes: VaultChange[]): void
  onIndexUpdated(snapshot: LinkIndexSnapshot): void
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

  constructor(private readonly events: VaultEvents) {}

  get current(): VaultProvider {
    if (!this.provider) throw new VaultError('NO_VAULT', 'No vault is open')
    return this.provider
  }

  async open(folder: string): Promise<VaultInfo> {
    const root = await realpath(folder)
    if (!(await stat(root)).isDirectory()) throw new VaultError('INVALID_PATH', 'Not a folder')
    const provider = new LocalFsProvider(root, { trash: (abs) => shell.trashItem(abs) })
    await this.seedTemplates(provider)
    await this.attach(provider)
    this.user = undefined
    this.author = localUserName()
    await saveSettings({ lastVault: root, lastServer: undefined })
    return { name: provider.name, root, author: this.author }
  }

  /** Opens a vault hosted by a team server. The server seeds templates and enforces who can see what. */
  async connect(url: string, token: string): Promise<VaultInfo> {
    const provider = await RemoteProvider.connect(url, token)
    await this.attach(provider)
    this.user = provider.user
    this.author = provider.user
    await rememberServer(provider.root, token)
    return { name: provider.name, root: provider.root, user: provider.user, author: provider.user, access: provider.access }
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

  snapshot(): LinkIndexSnapshot | null {
    return this.provider ? this.index.snapshot() : null
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

  rename(from: VaultPath, to: VaultPath): Promise<void> {
    return this.current.rename(from, to, this.author)
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
    const path = dailyNotePath(day, this.user)
    if (await provider.exists(path)) return { path, cursor: null }

    const custom = `${TEMPLATES_FOLDER}/${DAILY_TEMPLATE}`
    const source = (await provider.exists(custom)) ? (await provider.read(custom)).content : DEFAULT_TEMPLATES[DAILY_TEMPLATE]
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
      const snapshot = this.snapshot()
      if (snapshot) this.events.onIndexUpdated(snapshot)
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
