import { readFile, stat } from 'node:fs/promises'
import { basename as baseNameOf, join } from 'node:path'
import {
  app,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { MAX_ATTACHMENT_BYTES } from '@shared/attachments/attachments'
import { settingDef, type SettingKey } from '@shared/settings/schema'
import { VaultError, type IpcResult } from '@shared/vault/errors'
import { Channels } from '@shared/vault/ipc'
import { basename, normalizeVaultPath, sanitizeFileName, stripMd } from '@shared/vault/paths'
import type { WriteOptions } from '@shared/vault/types'
import type { AnalysisManager } from '../analysis/AnalysisManager'
import type { KeybindingsStore } from '../keybindings'
import type { SettingsStore } from '../settings'
import { installUpdate } from '../updates'
import { loadState, recallToken } from '../state'
import type { VaultManager } from '../vault/VaultManager'

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new VaultError('INVALID_ARGUMENT', `${name} must be a string`)
  return value
}

function strings(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string'))
    throw new VaultError('INVALID_ARGUMENT', `${name} must be a list of strings`)
  return value as string[]
}

function writeOptions(value: unknown): WriteOptions {
  if (value == null) return {}
  if (typeof value !== 'object') throw new VaultError('INVALID_ARGUMENT', 'options must be an object')
  // `author` is deliberately not taken from the renderer; VaultManager sets it.
  const { expectedVersion, createOnly, amendReason } = value as Record<string, unknown>
  return {
    expectedVersion: typeof expectedVersion === 'string' ? expectedVersion : undefined,
    createOnly: createOnly === true,
    amendReason: typeof amendReason === 'string' ? amendReason : undefined
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

export function registerIpc(
  vaults: VaultManager,
  settings: SettingsStore,
  keybindings: KeybindingsStore,
  analysis: AnalysisManager,
  getWindow: () => BrowserWindow | null
): void {
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
    const { lastVault, lastServer } = await loadState()
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
  handle(Channels.recordStatus, (path) => vaults.recordStatus(str(path, 'path')))
  handle(Channels.sign, (path, statement) =>
    vaults.sign(str(path, 'path'), statement === undefined ? undefined : str(statement, 'statement'))
  )
  handle(Channels.witness, (path) => vaults.witness(str(path, 'path')))
  handle(Channels.exportPdf, async (rawPath) => {
    const path = str(rawPath, 'path')
    const name = sanitizeFileName(stripMd(basename(path)) || vaults.current.name) || 'Prem export'
    const options: SaveDialogOptions = {
      title: 'Export as PDF',
      defaultPath: join(app.getPath('documents'), `${name}.pdf`),
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    }
    const win = getWindow()
    const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null
    const file = /\.pdf$/i.test(result.filePath) ? result.filePath : `${result.filePath}.pdf`
    const { notes } = await vaults.exportPdf(path, file)
    return { file, notes }
  })

  handle(Channels.readBinary, (path) => vaults.readBinary(str(path, 'path')))
  handle(Channels.addAttachment, (notePath, fileName, data) => {
    if (!(data instanceof Uint8Array)) throw new VaultError('INVALID_ARGUMENT', 'data must be bytes')
    return vaults.addAttachment(str(notePath, 'notePath'), str(fileName, 'fileName'), data)
  })
  handle(Channels.openFile, (path) => vaults.openFile(str(path, 'path')))
  handle(Channels.pickAttachments, async (notePath) => {
    const note = str(notePath, 'notePath')
    const options: OpenDialogOptions = { title: 'Attach files', properties: ['openFile', 'multiSelections'] }
    const win = getWindow()
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled) return []
    const added: string[] = []
    for (const file of result.filePaths) {
      if ((await stat(file)).size > MAX_ATTACHMENT_BYTES) {
        throw new VaultError(
          'INVALID_ARGUMENT',
          `"${baseNameOf(file)}" is over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB. Keep large raw data on shared storage and link to it.`
        )
      }
      const data = await readFile(file)
      added.push((await vaults.addAttachment(note, baseNameOf(file), new Uint8Array(data))).markdown)
    }
    return added
  })

  handle(Channels.listTemplates, () => vaults.listTemplates())
  handle(Channels.createFromTemplate, (templatePath, title, folder) =>
    vaults.createFromTemplate(str(templatePath, 'templatePath'), str(title, 'title'), str(folder, 'folder'))
  )

  handle(Channels.openDaily, (day) => vaults.openDaily(str(day, 'day')))

  handle(Channels.getIndex, () => vaults.snapshot())
  handle(Channels.search, (query) => vaults.find(str(query, 'query')))

  handle(Channels.getSettings, () => settings.current)
  handle(Channels.setSetting, (key, value) => {
    const name = str(key, 'key')
    if (!settingDef(name)) throw new VaultError('INVALID_ARGUMENT', `Unknown setting "${name}"`)
    return settings.set(name as SettingKey, value)
  })
  handle(Channels.openSettingsFile, async () => {
    const error = await shell.openPath(await settings.ensureFile())
    if (error) throw new VaultError('UNKNOWN', `Couldn't open settings.json: ${error}`)
  })

  handle(Channels.getKeybindings, () => keybindings.current)
  handle(Channels.setKeybinding, (command, key) =>
    keybindings.set(str(command, 'command'), key === null ? null : str(key, 'key'))
  )
  handle(Channels.resetKeybinding, (command) => keybindings.reset(str(command, 'command')))
  handle(Channels.openKeybindingsFile, async () => {
    const error = await shell.openPath(await keybindings.ensureFile())
    if (error) throw new VaultError('UNKNOWN', `Couldn't open keybindings.json: ${error}`)
  })

  handle(Channels.analysisStatus, (refresh) => analysis.status(refresh === true))
  handle(Channels.analysisPrepare, () => analysis.prepare())
  handle(Channels.analysisRun, (notePath, code) => analysis.run(str(notePath, 'notePath'), str(code, 'code')))
  handle(Channels.analysisInterrupt, (notePath) => analysis.interrupt(str(notePath, 'notePath')))
  handle(Channels.analysisRestart, (notePath) => analysis.stop(str(notePath, 'notePath')))
  handle(Channels.analysisReproduce, (notePath, codes, environment) => {
    if (!Array.isArray(codes) || !codes.every((c) => typeof c === 'string'))
      throw new VaultError('INVALID_ARGUMENT', 'codes must be a list of strings')
    return analysis.reproduce(
      str(notePath, 'notePath'),
      codes as string[],
      environment === null ? null : str(environment, 'environment')
    )
  })
  handle(Channels.analysisInputHashes, (paths) => {
    if (!Array.isArray(paths) || !paths.every((p) => typeof p === 'string'))
      throw new VaultError('INVALID_ARGUMENT', 'paths must be a list of strings')
    return analysis.inputHashes((paths as string[]).map((p) => normalizeVaultPath(p)))
  })

  handle(Channels.analysisCheck, (codes, reproduce) => {
    const notePath = (reproduce as { notePath?: unknown } | undefined)?.notePath
    const recorded = (reproduce as { recorded?: unknown } | undefined)?.recorded
    return analysis.check(
      strings(codes, 'codes'),
      reproduce === undefined || reproduce === null
        ? undefined
        : {
            notePath: normalizeVaultPath(str(notePath, 'notePath')),
            recorded: recorded === null ? null : str(recorded, 'recorded')
          }
    )
  })
  handle(Channels.analysisApprove, (approval) => {
    const { environment, code } = (approval ?? {}) as { environment?: unknown; code?: unknown }
    return analysis.approve({
      environment: environment === undefined ? undefined : str(environment, 'environment'),
      code: code === undefined ? undefined : strings(code, 'code')
    })
  })

  handle(Channels.installUpdate, () => installUpdate())

  handle(Channels.openExternal, async (url) => {
    const target = new URL(str(url, 'url'))
    if (!['http:', 'https:', 'mailto:'].includes(target.protocol)) {
      throw new VaultError('INVALID_ARGUMENT', `Refusing to open ${target.protocol} links`)
    }
    await shell.openExternal(target.toString())
  })
}
