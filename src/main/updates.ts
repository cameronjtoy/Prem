import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { canAutoUpdate, UPDATE_CHECK_MS } from '@shared/updates'

declare const PREM_SIGNED_BUILD: boolean

let downloaded: string | null = null

/**
 * Checks GitHub Releases for a newer Prem soon after launch and then once a day, downloads it in the
 * background, and tells the window when it's ready. Does nothing where updating isn't safe (see canAutoUpdate).
 */
export function startUpdates(options: { enabled(): boolean; onReady(version: string): void }): void {
  const allowed = (): boolean =>
    canAutoUpdate({
      packaged: app.isPackaged,
      signed: PREM_SIGNED_BUILD,
      appImage: !!process.env.APPIMAGE,
      enabled: options.enabled()
    })
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = {
    info: () => {},
    warn: (m) => console.warn('[updates]', m),
    error: (m) => console.error('[updates]', m),
    debug: () => {}
  }
  autoUpdater.on('update-downloaded', (info) => {
    downloaded = info.version
    options.onReady(info.version)
  })
  autoUpdater.on('error', (err) => console.warn('[updates] check failed:', err.message))
  const check = (): void => {
    if (allowed()) void autoUpdater.checkForUpdates().catch(() => {})
  }
  setTimeout(check, 30_000)
  setInterval(check, UPDATE_CHECK_MS)
}

/** Restarts into the downloaded version, if there is one. */
export function installUpdate(): void {
  if (downloaded) autoUpdater.quitAndInstall()
}
