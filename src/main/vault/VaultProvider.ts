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
  rename(from: VaultPath, to: VaultPath): Promise<void>
  remove(path: VaultPath): Promise<void>
  exists(path: VaultPath): Promise<boolean>
  watch(listener: (changes: VaultChange[]) => void): () => void
  dispose(): Promise<void>
}
