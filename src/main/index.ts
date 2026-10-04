import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { app, BrowserWindow, nativeTheme, shell } from 'electron'
import { resolveBindings, type KeybindingsSnapshot } from '@shared/keybindings'
import { DEFAULTS, type SettingsSnapshot } from '@shared/settings/schema'
import { Channels } from '@shared/vault/ipc'
import { registerIpc } from './ipc/handlers'
import { TrustStore } from './analysis/trust'
import { AnalysisManager } from './analysis/AnalysisManager'
import runnerSource from './analysis/prem_runner.py?raw'
import { KeybindingsStore } from './keybindings'
import { installMenu } from './menu'
import { SettingsStore } from './settings'
import { migrateState } from './state'
import { VaultManager } from './vault/VaultManager'

let mainWindow: BrowserWindow | null = null

const send = (channel: string, payload: unknown): void => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
}

function applySettings(snapshot: SettingsSnapshot): void {
  // The renderer's prefers-color-scheme follows this, so the theme needs nothing else.
  nativeTheme.themeSource = snapshot.values['appearance.theme'] as 'system' | 'light' | 'dark'
}

let settings: SettingsStore | null = null
let keybindings: KeybindingsStore | null = null

const applyKeybindings = (snapshot: KeybindingsSnapshot): void =>
  installMenu(() => mainWindow, resolveBindings(snapshot.entries))

const vaults = new VaultManager(
  {
    onChanged: (changes) => send(Channels.vaultChanged, changes),
    onIndexUpdated: (snapshot) => send(Channels.indexUpdated, snapshot)
  },
  () => settings?.values ?? DEFAULTS
)

/** The runner is written out once per launch, so it always matches this version of Prem. */
let runnerFile: Promise<string> | null = null
function runnerScript(): Promise<string> {
  runnerFile ??= (async () => {
    const file = path.join(app.getPath('userData'), 'runner', 'prem_runner.py')
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, runnerSource, 'utf8')
    return file
  })()
  return runnerFile
}

const analysis = new AnalysisManager({
  vaults,
  settings: () => settings?.values ?? DEFAULTS,
  envRoot: () => path.join(app.getPath('userData'), 'envs'),
  script: runnerScript,
  onProgress: (message) => send(Channels.analysisProgress, message),
  trust: new TrustStore(() => path.join(app.getPath('userData'), 'analysis-trust.json'))
})

function isSafeExternal(url: string): boolean {
  try {
    return ['http:', 'https:', 'mailto:'].includes(new URL(url).protocol)
  } catch {
    return false
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 500,
    show: false,
    title: 'Prem',
    backgroundColor: '#1e1e1e',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => (mainWindow = null))

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (isSafeExternal(url)) void shell.openExternal(url)
  })

  if (!app.isPackaged && devUrl) void mainWindow.loadURL(devUrl)
  else void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(async () => {
  await migrateState()
  settings = new SettingsStore(path.join(app.getPath('userData'), 'settings.json'), (snapshot) => {
    applySettings(snapshot)
    send(Channels.settingsChanged, snapshot)
  })
  applySettings(await settings.load())
  settings.watch()
  keybindings = new KeybindingsStore(path.join(app.getPath('userData'), 'keybindings.json'), (snapshot) => {
    applyKeybindings(snapshot)
    send(Channels.keybindingsChanged, snapshot)
  })
  applyKeybindings(await keybindings.load())
  keybindings.watch()
  registerIpc(vaults, settings, keybindings, analysis, () => mainWindow)
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  settings?.close()
  keybindings?.close()
  analysis.stopAll()
  void vaults.close()
})
