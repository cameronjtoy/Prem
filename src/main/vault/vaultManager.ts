import { realpath, stat } from 'node:fs/promises'
import { shell } from 'electron'
import { VaultError } from '@shared/errors'
import { LinkIndex } from '@shared/linkIndex'
import {
  basename,
  isMarkdown,
  isTemplate,
  joinPath,
  sanitizeFileName,
  TEMPLATES_FOLDER
} from '@shared/paths'
import { renderTemplate } from '@shared/templates'
import type {
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
import { DEFAULT_TEMPLATES } from './defaultTemplates'
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
  private unwatch: (() => void) | null = null
  private broadcastTimer: NodeJS.Timeout | null = null

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
    await saveSettings({ lastVault: root, lastServer: undefined })
    return { name: provider.name, root }
  }

  /** Opens a vault hosted by a team server. The server seeds templates and enforces who can see what. */
  async connect(url: string, token: string): Promise<VaultInfo> {
    const provider = await RemoteProvider.connect(url, token)
    await this.attach(provider)
    await rememberServer(provider.root, token)
    return { name: provider.name, root: provider.root, user: provider.user }
  }

  private async attach(provider: VaultProvider): Promise<void> {
    const index = new LinkIndex()
    index.build(await provider.readAllMarkdown())
    await this.close()
    this.index = index
    this.provider = provider
    this.unwatch = provider.watch((changes) => void this.handleChanges(changes))
  }

  async close(): Promise<void> {
    this.unwatch?.()
    this.unwatch = null
    await this.provider?.dispose()
    this.provider = null
  }

  snapshot(): LinkIndexSnapshot | null {
    return this.provider ? this.index.snapshot() : null
  }

  async write(path: VaultPath, content: string, options?: WriteOptions): Promise<WriteResult> {
    const result = await this.current.write(path, content, options)
    // Our own writes are filtered out of the watcher, so update the index directly.
    this.index.upsert(path, content)
    this.scheduleBroadcast()
    return result
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
      const { content, cursor } = renderTemplate(source, { title: name })
      try {
        await this.write(path, content, { createOnly: true })
        return { path, cursor }
      } catch (err) {
        if (!(err instanceof VaultError && err.code === 'EXISTS')) throw err
      }
    }
    throw new VaultError('EXISTS', `Could not find a free name for "${baseName}"`)
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
        if (change.type === 'deleted') this.index.removeFolder(change.path)
        continue
      }
      if (!isMarkdown(change.path)) continue
      if (change.type === 'deleted') {
        this.index.remove(change.path)
      } else {
        try {
          this.index.upsert(change.path, (await provider.read(change.path)).content)
        } catch {
          this.index.remove(change.path)
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
