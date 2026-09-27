import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { Channels, type Api } from '@shared/ipc'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.off(channel, handler)
}

const api: Api = {
  vault: {
    pickAndOpen: () => ipcRenderer.invoke(Channels.pickAndOpen),
    openLast: () => ipcRenderer.invoke(Channels.openLast),
    list: () => ipcRenderer.invoke(Channels.list),
    read: (path) => ipcRenderer.invoke(Channels.read, path),
    write: (path, content, options) => ipcRenderer.invoke(Channels.write, path, content, options),
    mkdir: (path) => ipcRenderer.invoke(Channels.mkdir, path),
    rename: (from, to) => ipcRenderer.invoke(Channels.rename, from, to),
    remove: (path) => ipcRenderer.invoke(Channels.remove, path),
    onChanged: (listener) => subscribe(Channels.vaultChanged, listener)
  },
  templates: {
    list: () => ipcRenderer.invoke(Channels.listTemplates),
    create: (templatePath, title, folder) =>
      ipcRenderer.invoke(Channels.createFromTemplate, templatePath, title, folder)
  },
  index: {
    get: () => ipcRenderer.invoke(Channels.getIndex),
    onUpdated: (listener) => subscribe(Channels.indexUpdated, listener)
  },
  app: {
    openExternal: (url) => ipcRenderer.invoke(Channels.openExternal, url)
  }
}

contextBridge.exposeInMainWorld('api', api)
