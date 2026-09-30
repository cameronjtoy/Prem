import { dialog, ipcMain, shell, type BrowserWindow, type OpenDialogOptions } from 'electron'
import { VaultError, type IpcResult } from '@shared/errors'
import { Channels } from '@shared/ipc'
import type { WriteOptions } from '@shared/types'
import { loadSettings, recallToken } from '../settings'
import type { VaultManager } from '../vault/vaultManager'

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new VaultError('INVALID_ARGUMENT', `${name} must be a string`)
  return value
}

function writeOptions(value: unknown): WriteOptions {
  if (value == null) return {}
  if (typeof value !== 'object') throw new VaultError('INVALID_ARGUMENT', 'options must be an object')
  const { expectedVersion, createOnly } = value as Record<string, unknown>
  return {
    expectedVersion: typeof expectedVersion === 'string' ? expectedVersion : undefined,
    createOnly: createOnly === true
  }
}

function handle<T>(channel: string, fn: (...args: unknown[]) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<IpcResult<T>> => {
    try {
      return { ok: true, value: await fn(...args) }
    } catch (err) {
      if (err instanceof VaultError) return { ok: false, error: { code: err.code, message: err.message } }
      console.error(`[ipc] ${channel} failed`, err)
      return { ok: false, error: { code: 'UNKNOWN', message: err instanceof Error ? err.message : String(err) } }
    }
  })
}

export function registerIpc(vaults: VaultManager, getWindow: () => BrowserWindow | null): void {
  handle(Channels.pickAndOpen, async () => {
    const win = getWindow()
    const options: OpenDialogOptions = {
      title: 'Open folder as vault',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || !result.filePaths[0]) return null
    return vaults.open(result.filePaths[0])
  })

  handle(Channels.connect, (url, token) => vaults.connect(str(url, 'url'), str(token, 'token')))

  handle(Channels.openLast, async () => {
    const { lastVault, lastServer } = await loadSettings()
    if (lastServer) {
      const token = recallToken(lastServer)
      // A team server that's down shouldn't silently fall back to some other vault, so surface the error.
      return token ? vaults.connect(lastServer.url, token) : null
    }
    if (!lastVault) return null
    try {
      return await vaults.open(lastVault)
    } catch {
      return null
    }
  })

  handle(Channels.list, () => vaults.current.list())
  handle(Channels.read, (path) => vaults.current.read(str(path, 'path')))
  handle(Channels.write, (path, content, options) =>
    vaults.write(str(path, 'path'), str(content, 'content'), writeOptions(options))
  )
  handle(Channels.mkdir, (path) => vaults.current.mkdir(str(path, 'path')))
  handle(Channels.rename, (from, to) => vaults.rename(str(from, 'from'), str(to, 'to')))
  handle(Channels.remove, (path) => vaults.remove(str(path, 'path')))
  handle(Channels.history, (path) => vaults.history(str(path, 'path')))
  handle(Channels.readVersion, (path, id) => vaults.readVersion(str(path, 'path'), str(id, 'id')))

  handle(Channels.readBinary, (path) => vaults.readBinary(str(path, 'path')))
  handle(Channels.addAttachment, (notePath, fileName, data) => {
    if (!(data instanceof Uint8Array)) throw new VaultError('INVALID_ARGUMENT', 'data must be bytes')
    return vaults.addAttachment(str(notePath, 'notePath'), str(fileName, 'fileName'), data)
  })
  handle(Channels.openFile, (path) => vaults.openFile(str(path, 'path')))

  handle(Channels.listTemplates, () => vaults.listTemplates())
  handle(Channels.createFromTemplate, (templatePath, title, folder) =>
    vaults.createFromTemplate(str(templatePath, 'templatePath'), str(title, 'title'), str(folder, 'folder'))
  )

  handle(Channels.openDaily, (day) => vaults.openDaily(str(day, 'day')))

  handle(Channels.getIndex, () => vaults.snapshot())
  handle(Channels.search, (query) => vaults.find(str(query, 'query')))

  handle(Channels.openExternal, async (url) => {
    const target = new URL(str(url, 'url'))
    if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) {
      throw new VaultError('INVALID_ARGUMENT', `Refusing to open ${target.protocol} links`)
    }
    await shell.openExternal(target.toString())
  })
}
