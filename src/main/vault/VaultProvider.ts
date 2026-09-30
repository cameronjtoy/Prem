import type { HistoryEntry } from '@shared/history'
import type { RecordCheck } from '@shared/signatures'
import type {
  FileRecord,
  VaultChange,
  VaultEntry,
  VaultPath,
  WriteOptions,
  WriteResult
} from '@shared/types'

/**
 * Storage backend for one vault. Everything above this interface uses vault-relative paths,
 * so a remote/sync backend can replace LocalFsProvider without changes elsewhere.
 */
export interface VaultProvider {
  readonly name: string
  readonly root: string
  list(): Promise<VaultEntry[]>
  read(path: VaultPath): Promise<FileRecord>
  readAllMarkdown(): Promise<FileRecord[]>
  write(path: VaultPath, content: string, options?: WriteOptions): Promise<WriteResult>
  /** Attachments: any file except notes, read and written as raw bytes. */
  readBinary(path: VaultPath): Promise<Uint8Array>
  writeBinary(path: VaultPath, data: Uint8Array, options?: WriteOptions): Promise<WriteResult>
  mkdir(path: VaultPath): Promise<void>
  /** `author` is recorded in the note's history. Remote providers ignore it: the server knows who you are. */
  rename(from: VaultPath, to: VaultPath, author?: string): Promise<void>
  remove(path: VaultPath, author?: string): Promise<void>
  /** Every recorded version of a note, oldest first. */
  history(path: VaultPath): Promise<HistoryEntry[]>
  readVersion(path: VaultPath, id: string): Promise<string>
  /** Signing: `author` is ignored by remote providers, where the server signs as whoever you're signed in as. */
  sign(path: VaultPath, author: string, statement?: string): Promise<RecordCheck>
  witness(path: VaultPath, author: string): Promise<RecordCheck>
  recordStatus(path: VaultPath): Promise<RecordCheck>
  exists(path: VaultPath): Promise<boolean>
  watch(listener: (changes: VaultChange[]) => void): () => void
  dispose(): Promise<void>
}
