import type { IpcResult } from './errors'
import type {
  CreatedNote,
  FileRecord,
  LinkIndexSnapshot,
  TemplateInfo,
  VaultChange,
  VaultEntry,
  VaultInfo,
  WriteOptions,
  WriteResult
} from './types'

export const Channels = {
  pickAndOpen: 'vault:pickAndOpen',
  openLast: 'vault:openLast',
  list: 'vault:list',
  read: 'vault:read',
  write: 'vault:write',
  mkdir: 'vault:mkdir',
  rename: 'vault:rename',
  remove: 'vault:delete',
  listTemplates: 'templates:list',
  createFromTemplate: 'templates:create',
  getIndex: 'index:get',
  openExternal: 'app:openExternal',
  vaultChanged: 'vault:changed',
  indexUpdated: 'index:updated'
} as const

type R<T> = Promise<IpcResult<T>>

/** The surface exposed to the renderer as `window.api`. */
export interface Api {
  vault: {
    pickAndOpen(): R<VaultInfo | null>
    openLast(): R<VaultInfo | null>
    list(): R<VaultEntry[]>
    read(path: string): R<FileRecord>
    write(path: string, content: string, options?: WriteOptions): R<WriteResult>
    mkdir(path: string): R<void>
    rename(from: string, to: string): R<void>
    remove(path: string): R<void>
    onChanged(listener: (changes: VaultChange[]) => void): () => void
  }
  templates: {
    list(): R<TemplateInfo[]>
    create(templatePath: string, title: string, folder: string): R<CreatedNote>
  }
  index: {
    get(): R<LinkIndexSnapshot | null>
    onUpdated(listener: (snapshot: LinkIndexSnapshot) => void): () => void
  }
  app: {
    openExternal(url: string): R<void>
  }
}
