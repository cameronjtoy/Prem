import type { IpcResult } from './errors'
import type { HistoryEntry } from '../records/history'
import type { SearchHit } from '../search/search'
import type { RecordCheck } from '../records/signatures'
import type {
  AddedAttachment,
  CreatedNote,
  FileRecord,
  LinkIndexSnapshot,
  RenameResult,
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
  connect: 'vault:connect',
  list: 'vault:list',
  read: 'vault:read',
  write: 'vault:write',
  mkdir: 'vault:mkdir',
  rename: 'vault:rename',
  remove: 'vault:delete',
  readBinary: 'vault:readBinary',
  history: 'history:list',
  readVersion: 'history:read',
  recordStatus: 'record:status',
  sign: 'record:sign',
  witness: 'record:witness',
  exportPdf: 'record:exportPdf',
  addAttachment: 'attachments:add',
  openFile: 'attachments:open',
  listTemplates: 'templates:list',
  createFromTemplate: 'templates:create',
  openDaily: 'notebook:openDaily',
  getIndex: 'index:get',
  search: 'search:query',
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
    connect(url: string, token: string): R<VaultInfo>
    list(): R<VaultEntry[]>
    read(path: string): R<FileRecord>
    write(path: string, content: string, options?: WriteOptions): R<WriteResult>
    mkdir(path: string): R<void>
    /** Moves a note, attachment or folder, and rewrites links to it in other notes. */
    rename(from: string, to: string): R<RenameResult>
    remove(path: string): R<void>
    readBinary(path: string): R<Uint8Array>
    onChanged(listener: (changes: VaultChange[]) => void): () => void
  }
  attachments: {
    add(notePath: string, fileName: string, data: Uint8Array): R<AddedAttachment>
    /** Opens a file in its default app, or shows it in its folder if it isn't a known data format. */
    open(path: string): R<void>
  }
  history: {
    list(path: string): R<HistoryEntry[]>
    read(path: string, id: string): R<string>
  }
  record: {
    status(path: string): R<RecordCheck>
    sign(path: string, statement?: string): R<RecordCheck>
    witness(path: string): R<RecordCheck>
    /**
     * Asks where to save, then prints a note or every note in a folder to PDF with its signatures and
     * history check. Returns the saved file, or null if the person cancelled.
     */
    exportPdf(path: string): R<{ file: string; notes: number } | null>
  }
  templates: {
    list(): R<TemplateInfo[]>
    create(templatePath: string, title: string, folder: string): R<CreatedNote>
  }
  notebook: {
    /** Opens or creates the daily entry for a YYYY-MM-DD day. */
    openDaily(day: string): R<CreatedNote>
  }
  search(query: string): R<SearchHit[]>
  index: {
    get(): R<LinkIndexSnapshot | null>
    onUpdated(listener: (snapshot: LinkIndexSnapshot) => void): () => void
  }
  app: {
    openExternal(url: string): R<void>
  }
}
