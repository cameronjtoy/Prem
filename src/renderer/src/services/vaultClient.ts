import { VaultError, type IpcResult } from '@shared/errors'
import type { WriteOptions } from '@shared/types'

async function unwrap<T>(pending: Promise<IpcResult<T>>): Promise<T> {
  const result = await pending
  if (result.ok) return result.value
  throw new VaultError(result.error.code, result.error.message)
}

/** The renderer's only way to reach storage. Components never call `window.api` directly. */
export const vaultClient = {
  pickAndOpen: () => unwrap(window.api.vault.pickAndOpen()),
  openLast: () => unwrap(window.api.vault.openLast()),
  connect: (url: string, token: string) => unwrap(window.api.vault.connect(url, token)),
  list: () => unwrap(window.api.vault.list()),
  read: (path: string) => unwrap(window.api.vault.read(path)),
  write: (path: string, content: string, options?: WriteOptions) =>
    unwrap(window.api.vault.write(path, content, options)),
  mkdir: (path: string) => unwrap(window.api.vault.mkdir(path)),
  rename: (from: string, to: string) => unwrap(window.api.vault.rename(from, to)),
  remove: (path: string) => unwrap(window.api.vault.remove(path)),
  onChanged: window.api.vault.onChanged,
  listTemplates: () => unwrap(window.api.templates.list()),
  createFromTemplate: (templatePath: string, title: string, folder: string) =>
    unwrap(window.api.templates.create(templatePath, title, folder)),
  openDaily: (day: string) => unwrap(window.api.notebook.openDaily(day)),
  getIndex: () => unwrap(window.api.index.get()),
  onIndexUpdated: window.api.index.onUpdated,
  openExternal: (url: string) => unwrap(window.api.app.openExternal(url))
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
