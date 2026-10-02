import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { expect, openNote, savedStatus, test } from './fixtures'

const TODAY = /^Notebook\/\d{4}\/\d{4}-\d\d-\d\d\.md$/

const readJson = async (file: string): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'))

async function openShortcutsTab(page: Page): Promise<void> {
  await page.keyboard.press('ControlOrMeta+Comma')
  await page.getByRole('tab', { name: 'Keyboard shortcuts' }).click()
  await expect(page.locator('.settings-search')).toBeFocused()
}

async function record(page: Page, command: string, keys: string): Promise<void> {
  const row = page.locator(`[data-command="${command}"]`)
  await row.getByRole('button', { name: 'Change' }).click()
  await expect(row.locator('.key-recorder')).toBeFocused()
  await page.keyboard.press(keys)
}

test('a shortcut changed on the Settings screen is saved and works straight away', async ({
  prem: { page, read, userData }
}) => {
  const file = path.join(userData, 'keybindings.json')
  await openNote(page, 'Samples/S-0001.md')
  await openShortcutsTab(page)
  await page.locator('.settings-search').fill('insert link')
  await record(page, 'format.link', 'ControlOrMeta+Shift+KeyL')
  const row = page.locator('[data-command="format.link"]')
  await expect(row.locator('.shortcut-key')).toHaveText(/Shift.*L/)
  await expect(row).toContainText('Modified')
  await expect.poll(() => readJson(file)).toEqual([{ key: 'Mod+Shift+L', command: 'format.link' }])
  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-page')).toBeHidden()

  await page.locator('.cm-content').click()
  await expect(page.locator('.cm-content')).toBeFocused()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nsee ')
  await page.keyboard.press('ControlOrMeta+Shift+KeyL')
  await page.keyboard.type('S-0002')
  await page.keyboard.press('Escape')
  await savedStatus(page)
  await expect.poll(() => read('Samples/S-0001.md')).toContain('see [[S-0002]]')
})

test('taking a shortcut another command uses asks first, and Replace moves it', async ({
  prem: { page, userData }
}) => {
  const file = path.join(userData, 'keybindings.json')
  await openShortcutsTab(page)
  await record(page, 'note.today', 'ControlOrMeta+KeyK')
  const conflict = page.locator('[data-command="note.today"] .shortcut-conflict')
  await expect(conflict).toContainText('also used by Search all notes')
  await conflict.getByRole('button', { name: 'Replace' }).click()
  await expect.poll(() => readJson(file)).toEqual([{ key: 'Mod+K', command: 'note.today' }, { command: '-app.search' }])
  await expect(page.locator('[data-command="app.search"] .shortcut-key')).toHaveText('None')

  await page.keyboard.press('Escape')
  await expect(page.locator('.settings-page')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+KeyK')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', TODAY)
  await expect(page.locator('.search-modal')).toBeHidden()
})

test('editing keybindings.json applies straight away, menus included, and a mistake keeps the last good keys', async ({
  prem: { app, page, userData }
}) => {
  const file = path.join(userData, 'keybindings.json')
  const todayAccelerator = () =>
    app.evaluate(({ Menu }) => {
      const fileMenu = Menu.getApplicationMenu()!.items.find((i) => i.label === 'File')!
      return fileMenu.submenu!.items.find((i) => i.label === "Today's entry")?.accelerator
    })

  await writeFile(file, JSON.stringify([{ key: 'Mod+Shift+Y', command: 'note.today' }]))
  await expect.poll(todayAccelerator).toBe('CmdOrCtrl+Shift+Y')
  await writeFile(file, '[{ "key": "Mod+Shift+U", "command": "note.today" },]')
  await expect(page.locator('.settings-trouble')).toContainText('keybindings.json has a mistake at line 1')
  expect(await todayAccelerator()).toBe('CmdOrCtrl+Shift+Y')

  await page.keyboard.press('ControlOrMeta+Shift+KeyY')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', TODAY)

  await page.locator('.settings-trouble').getByRole('button', { name: 'Show' }).click()
  await expect(page.getByRole('tab', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.locator('.settings-page .banner.error')).toContainText('keybindings.json has a mistake')
})

test('a shortcut can be removed and reset, starting from the shortcuts sheet', async ({ prem: { page, userData } }) => {
  const file = path.join(userData, 'keybindings.json')
  await page.keyboard.press('ControlOrMeta+Slash')
  await page.getByRole('button', { name: 'Change shortcuts…' }).click()
  await expect(page.getByRole('tab', { name: 'Keyboard shortcuts' })).toHaveAttribute('aria-selected', 'true')

  const row = page.locator('[data-command="view.graph"]')
  await row.getByRole('button', { name: 'Remove' }).click()
  await expect(row.locator('.shortcut-key')).toHaveText('None')
  await expect.poll(() => readJson(file)).toEqual([{ command: '-view.graph' }])

  await row.getByRole('button', { name: 'Reset' }).click()
  await expect(row.locator('.shortcut-key')).not.toHaveText('None')
  await expect.poll(() => readJson(file)).toEqual([])
  await expect(row).not.toContainText('Modified')
})
