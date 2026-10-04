import type { Approval } from '@shared/analysis/trust'
import { VaultError, type IpcResult } from '@shared/vault/errors'
import type { SettingKey } from '@shared/settings/schema'
import type { WriteOptions } from '@shared/vault/types'

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
  readBinary: (path: string) => unwrap(window.api.vault.readBinary(path)),
  history: (path: string) => unwrap(window.api.history.list(path)),
  readVersion: (path: string, id: string) => unwrap(window.api.history.read(path, id)),
  recordStatus: (path: string) => unwrap(window.api.record.status(path)),
  sign: (path: string, statement?: string) => unwrap(window.api.record.sign(path, statement)),
  witness: (path: string) => unwrap(window.api.record.witness(path)),
  exportPdf: (path: string) => unwrap(window.api.record.exportPdf(path)),
  addAttachment: (notePath: string, fileName: string, data: Uint8Array) =>
    unwrap(window.api.attachments.add(notePath, fileName, data)),
  openFile: (path: string) => unwrap(window.api.attachments.open(path)),
  pickAttachments: (notePath: string) => unwrap(window.api.attachments.pick(notePath)),
  onChanged: window.api.vault.onChanged,
  listTemplates: () => unwrap(window.api.templates.list()),
  createFromTemplate: (templatePath: string, title: string, folder: string) =>
    unwrap(window.api.templates.create(templatePath, title, folder)),
  openDaily: (day: string) => unwrap(window.api.notebook.openDaily(day)),
  getIndex: () => unwrap(window.api.index.get()),
  search: (query: string) => unwrap(window.api.search(query)),
  onIndexUpdated: window.api.index.onUpdated,
  openExternal: (url: string) => unwrap(window.api.app.openExternal(url)),
  getSettings: () => unwrap(window.api.settings.get()),
  setSetting: (key: SettingKey, value: unknown) => unwrap(window.api.settings.set(key, value)),
  openSettingsFile: () => unwrap(window.api.settings.openFile()),
  onSettingsChanged: window.api.settings.onChanged,
  getKeybindings: () => unwrap(window.api.keybindings.get()),
  setKeybinding: (command: string, key: string | null) => unwrap(window.api.keybindings.set(command, key)),
  resetKeybinding: (command: string) => unwrap(window.api.keybindings.reset(command)),
  openKeybindingsFile: () => unwrap(window.api.keybindings.openFile()),
  onKeybindingsChanged: window.api.keybindings.onChanged,
  analysisStatus: (refresh?: boolean) => unwrap(window.api.analysis.status(refresh)),
  prepareAnalysis: () => unwrap(window.api.analysis.prepare()),
  runCell: (notePath: string, code: string) => unwrap(window.api.analysis.run(notePath, code)),
  interruptCell: (notePath: string) => unwrap(window.api.analysis.interrupt(notePath)),
  restartAnalysis: (notePath: string) => unwrap(window.api.analysis.restart(notePath)),
  onAnalysisProgress: window.api.analysis.onProgress,
  reproduce: (notePath: string, codes: string[], environment: string | null) =>
    unwrap(window.api.analysis.reproduce(notePath, codes, environment)),
  inputHashes: (paths: string[]) => unwrap(window.api.analysis.inputHashes(paths)),
  checkRun: (codes: string[], reproduce?: { notePath: string; recorded: string | null }) =>
    unwrap(window.api.analysis.check(codes, reproduce)),
  approveRun: (approval: Approval) => unwrap(window.api.analysis.approve(approval))
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
