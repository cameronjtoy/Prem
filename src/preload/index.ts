import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channels, type Api } from '@shared/vault/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: Api = {
  vault: {
    pickAndOpen: () => ipcRenderer.invoke(Channels.pickAndOpen),
    openLast: () => ipcRenderer.invoke(Channels.openLast),
    connect: (url, token) => ipcRenderer.invoke(Channels.connect, url, token),
    list: () => ipcRenderer.invoke(Channels.list),
    read: (path) => ipcRenderer.invoke(Channels.read, path),
    write: (path, content, options) => ipcRenderer.invoke(Channels.write, path, content, options),
    mkdir: (path) => ipcRenderer.invoke(Channels.mkdir, path),
    rename: (from, to) => ipcRenderer.invoke(Channels.rename, from, to),
    remove: (path) => ipcRenderer.invoke(Channels.remove, path),
    readBinary: (path) => ipcRenderer.invoke(Channels.readBinary, path),
    onChanged: (listener) => subscribe(Channels.vaultChanged, listener)
  },
  attachments: {
    add: (notePath, fileName, data) => ipcRenderer.invoke(Channels.addAttachment, notePath, fileName, data),
    pick: (notePath) => ipcRenderer.invoke(Channels.pickAttachments, notePath),
    open: (path) => ipcRenderer.invoke(Channels.openFile, path)
  },
  history: {
    list: (path) => ipcRenderer.invoke(Channels.history, path),
    read: (path, id) => ipcRenderer.invoke(Channels.readVersion, path, id)
  },
  record: {
    status: (path) => ipcRenderer.invoke(Channels.recordStatus, path),
    sign: (path, statement) => ipcRenderer.invoke(Channels.sign, path, statement),
    witness: (path) => ipcRenderer.invoke(Channels.witness, path),
    exportPdf: (path) => ipcRenderer.invoke(Channels.exportPdf, path),
    backup: () => ipcRenderer.invoke(Channels.backupVault)
  },
  templates: {
    list: () => ipcRenderer.invoke(Channels.listTemplates),
    create: (templatePath, title, folder) =>
      ipcRenderer.invoke(Channels.createFromTemplate, templatePath, title, folder)
  },
  notebook: {
    openDaily: (day) => ipcRenderer.invoke(Channels.openDaily, day)
  },
  search: (query) => ipcRenderer.invoke(Channels.search, query),
  index: {
    get: () => ipcRenderer.invoke(Channels.getIndex),
    links: (path) => ipcRenderer.invoke(Channels.indexLinks, path),
    graph: () => ipcRenderer.invoke(Channels.indexGraph),
    onUpdated: (listener) => subscribe(Channels.indexUpdated, listener)
  },
  settings: {
    get: () => ipcRenderer.invoke(Channels.getSettings),
    set: (key, value) => ipcRenderer.invoke(Channels.setSetting, key, value),
    openFile: () => ipcRenderer.invoke(Channels.openSettingsFile),
    onChanged: (listener) => subscribe(Channels.settingsChanged, listener)
  },
  keybindings: {
    get: () => ipcRenderer.invoke(Channels.getKeybindings),
    set: (command, key) => ipcRenderer.invoke(Channels.setKeybinding, command, key),
    reset: (command) => ipcRenderer.invoke(Channels.resetKeybinding, command),
    openFile: () => ipcRenderer.invoke(Channels.openKeybindingsFile),
    onChanged: (listener) => subscribe(Channels.keybindingsChanged, listener)
  },
  analysis: {
    status: (refresh) => ipcRenderer.invoke(Channels.analysisStatus, refresh),
    prepare: () => ipcRenderer.invoke(Channels.analysisPrepare),
    run: (notePath, code) => ipcRenderer.invoke(Channels.analysisRun, notePath, code),
    interrupt: (notePath) => ipcRenderer.invoke(Channels.analysisInterrupt, notePath),
    restart: (notePath) => ipcRenderer.invoke(Channels.analysisRestart, notePath),
    onProgress: (listener) => subscribe(Channels.analysisProgress, listener),
    reproduce: (notePath, codes, environment) =>
      ipcRenderer.invoke(Channels.analysisReproduce, notePath, codes, environment),
    inputHashes: (paths) => ipcRenderer.invoke(Channels.analysisInputHashes, paths),
    check: (codes, reproduce) => ipcRenderer.invoke(Channels.analysisCheck, codes, reproduce),
    approve: (approval) => ipcRenderer.invoke(Channels.analysisApprove, approval)
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke(Channels.openExternal, url),
    logError: (message) => ipcRenderer.invoke(Channels.logError, message),
    diagnostics: () => ipcRenderer.invoke(Channels.diagnostics),
    showLogs: () => ipcRenderer.invoke(Channels.showLogs),
    onCommand: (listener) => subscribe(Channels.command, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)
