// Shared setup for the end-to-end tests: each test gets the built app, a fresh copy of the example vault
// and its own settings folder, so tests can run in parallel and never touch a real vault.
import { execFileSync } from 'node:child_process'
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from '@playwright/test'

import type { Api } from '../src/shared/vault/ipc'

// Tests reach the app's API directly with page.evaluate, as the renderer does.
declare global {
  interface Window {
    api: Api
  }
}

export const ROOT = path.resolve(__dirname, '..')
const SAMPLE_VAULT = path.join(ROOT, 'examples', 'sample-vault')

export interface Prem {
  app: ElectronApplication
  page: Page
  /** Absolute path of this test's vault. */
  vault: string
  /** Reads a file in the vault. */
  read(vaultPath: string): Promise<string>
  /** This test's settings folder, where settings.json and state.json live. */
  userData: string
}

export async function tempDir(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `prem-e2e-${prefix}-`))
}

/** Starts Prem. With a vault it opens straight into it; without one it shows the welcome screen. */
export async function launch(
  options: { vault?: string; userData?: string } = {}
): Promise<{ app: ElectronApplication; page: Page; userData: string; blocked: string[] }> {
  const userData = options.userData ?? (await tempDir('settings'))
  if (options.vault) await writeFile(path.join(userData, 'state.json'), JSON.stringify({ lastVault: options.vault }))
  const app = await electron.launch({ args: [ROOT, '--no-sandbox', `--user-data-dir=${userData}`] })
  // Tests stand in for the operating system: no real save dialogs, browsers or default apps.
  await app.evaluate(({ shell }) => {
    const g = globalThis as unknown as { opened: string[]; external: string[] }
    g.opened = []
    g.external = []
    shell.openPath = async (p: string) => (g.opened.push(p), '')
    shell.openExternal = async (u: string) => void g.external.push(u)
  })
  const page = await app.firstWindow()
  // Anything the Content-Security-Policy blocks: the app should never try to load something it forbids.
  const blocked: string[] = []
  page.on('console', (m) => /Content Security Policy/i.test(m.text()) && blocked.push(m.text()))
  await page.setViewportSize({ width: 1280, height: 860 })
  // Without a vault given, the settings folder may still remember one.
  // The file list may be hidden, so wait for the main pane.
  await page.waitForSelector(options.vault ? '.main-pane' : '.main-pane, .welcome-card')
  return { app, page, userData, blocked }
}

/** Makes the next "Save as" dialog choose `file`. */
export async function answerSaveDialog(app: ElectronApplication, file: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: target })
  }, file)
}

export async function openedFiles(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)
}

export async function externalLinks(app: ElectronApplication): Promise<string[]> {
  return app.evaluate(() => (globalThis as unknown as { external: string[] }).external)
}

/** Expands the folders above a path in the file tree, leaving open ones open. */
export async function reveal(page: Page, vaultPath: string): Promise<void> {
  const parts = vaultPath.split('/')
  for (let i = 1; i < parts.length; i++) {
    const folder = parts.slice(0, i).join('/')
    if (!(await page.locator(`.file-tree [title^="${folder}/"]`).count())) {
      await page.locator(`.file-tree [title="${folder}"]`).click()
    }
    await expect(page.locator(`.file-tree [title^="${folder}/"]`).first()).toBeVisible()
  }
}

export async function openNote(page: Page, vaultPath: string): Promise<void> {
  await reveal(page, vaultPath)
  await page.locator(`.file-tree [title="${vaultPath}"]`).click()
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', vaultPath)
  await expect(page.locator('.cm-content')).toBeVisible()
  // The editor shows before its commands are enabled; a shortcut pressed in between would do nothing.
  await expect(page.locator('.note-editor[data-ready]')).toBeVisible()
}

export async function rename(page: Page, vaultPath: string, newName: string): Promise<void> {
  await reveal(page, vaultPath)
  await page.locator(`.file-tree [title="${vaultPath}"]`).click({ button: 'right' })
  await menuItem(page, 'Rename').click()
  const input = page.locator('.file-tree input')
  await input.fill(newName)
  await input.press('Enter')
}

export const menuItem = (page: Page, label: string) => page.locator('.context-menu').getByText(label, { exact: true })

/** The dialog that asks before code or package installs run on this computer. */
export const approvalDialog = (page: Page) => page.getByRole('dialog', { name: /^(Run code|Install packages)$/ })

/** Answers that dialog: runs or installs (the default), or cancels. */
export async function approve(page: Page, answer: 'go' | 'cancel' = 'go'): Promise<void> {
  const dialog = approvalDialog(page)
  await dialog.getByRole('button', { name: answer === 'go' ? /^(Run|Install|Install and run)$/ : 'Cancel' }).click()
  await expect(dialog).toBeHidden()
}

export const savedStatus = (page: Page) => expect(page.locator('.save-status')).toHaveText('Saved')

/** Each test gets Prem open on its own copy of the example vault. */
export const test = base.extend<{ prem: Prem }>({
  prem: async ({}, use) => {
    const vault = await tempDir('vault')
    await cp(SAMPLE_VAULT, vault, { recursive: true })
    const { app, page, userData, blocked } = await launch({ vault })
    await use({ app, page, vault, userData, read: (p) => readFile(path.join(vault, p), 'utf8') })
    await app.close()
    expect(blocked, 'blocked by the Content-Security-Policy').toEqual([])
    await rm(vault, { recursive: true, force: true })
  }
})

/** A tiny package as a wheel, so building environments needs no network. */
export function makeWheel(dir: string, name = 'premtiny'): string {
  const wheel = path.join(dir, `${name}-1.0-py3-none-any.whl`)
  execFileSync('python3', [
    '-c',
    `import zipfile, sys
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr(sys.argv[2] + "/__init__.py", "VALUE = 42\\n")
    z.writestr(sys.argv[2] + "-1.0.dist-info/METADATA", "Metadata-Version: 2.1\\nName: " + sys.argv[2] + "\\nVersion: 1.0\\n")
    z.writestr(sys.argv[2] + "-1.0.dist-info/WHEEL", "Wheel-Version: 1.0\\nGenerator: prem-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n")
    z.writestr(sys.argv[2] + "-1.0.dist-info/RECORD", "")`,
    wheel,
    name
  ])
  return wheel
}

export { expect }
