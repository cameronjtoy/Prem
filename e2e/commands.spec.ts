import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { expect, openNote, savedStatus, tempDir, test } from './fixtures'

const EXPERIMENT = 'Notebook/2026/Ligation of insert into pUC19.md'
const PROTOCOL = 'Protocols/Plasmid miniprep.md'

test('the command palette runs a command by name', async ({ prem: { page } }) => {
  await page.keyboard.press('ControlOrMeta+Shift+KeyP')
  const palette = page.locator('.palette')
  await expect(palette).toBeVisible()
  await palette.locator('input').fill('today')
  await expect(palette.locator('li').first()).toContainText("Today's entry")
  await expect(palette.locator('li').first().locator('.palette-key')).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', /^Notebook\/\d{4}\/\d{4}-\d\d-\d\d\.md$/)
})

test('the quick switcher opens a note by name, and back and forward retrace your steps', async ({ prem: { page } }) => {
  await openNote(page, 'Welcome.md')
  await page.keyboard.press('ControlOrMeta+KeyE')
  await page.locator('.palette input').fill('ligation')
  await expect(page.locator('.palette li').first()).toContainText('Ligation')
  await page.keyboard.press('Enter')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', EXPERIMENT)

  await page.keyboard.press('ControlOrMeta+BracketLeft')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', 'Welcome.md')
  await page.keyboard.press('ControlOrMeta+BracketRight')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', EXPERIMENT)
})

test('formatting shortcuts edit the note', async ({ prem: { page, read } }) => {
  await openNote(page, 'Samples/S-0001.md')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nbuffer')
  await page.keyboard.press('Shift+Home')
  await page.keyboard.press('ControlOrMeta+KeyB')
  await page.keyboard.press('End')
  await page.keyboard.type(' see ')
  await page.keyboard.press('ControlOrMeta+KeyL')
  await page.keyboard.type('S-0002')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+Alt+Digit2')
  await savedStatus(page)
  await expect.poll(() => read('Samples/S-0001.md')).toContain('## **buffer** see [[S-0002]]')

  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.press('ControlOrMeta+Shift+KeyT')
  await savedStatus(page)
  await expect.poll(() => read('Samples/S-0001.md')).toMatch(/\n\d{4}-\d\d-\d\d \d\d:\d\d$/)
})

test('run shortcuts start a run, tick a step with its time, and log a deviation', async ({ prem: { page, read } }) => {
  await openNote(page, PROTOCOL)
  await page.keyboard.press('ControlOrMeta+Shift+KeyR')
  await expect(page.locator('.run-bar')).toContainText('Run in progress')
  const runPath = (await page.locator('.breadcrumb').getAttribute('title'))!

  await page.locator('.cm-line', { hasText: 'Pellet 2 mL' }).click()
  await page.keyboard.press('ControlOrMeta+Enter')
  await savedStatus(page)
  await expect.poll(() => read(runPath)).toMatch(/1\. \[x\] Pellet .*✓ \d\d:\d\d/)

  await page.keyboard.press('ControlOrMeta+Shift+KeyD')
  await savedStatus(page)
  await expect.poll(() => read(runPath)).toMatch(/## Deviations\n- \d\d:\d\d/)
})

test('sign and history open from the keyboard', async ({ prem: { page } }) => {
  await openNote(page, EXPERIMENT)
  await page.keyboard.press('ControlOrMeta+Shift+KeyS')
  await expect(page.locator('.record-form input')).toBeFocused()
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+Shift+KeyH')
  await expect(page.locator('.history-modal')).toBeVisible()
})

test('attaching from the keyboard stores the chosen file and links it', async ({ prem: { app, page, read } }) => {
  const dir = await tempDir('attach')
  const file = path.join(dir, 'plate read.csv')
  await writeFile(file, 'well,od\nA1,0.41\n')
  await app.evaluate(({ dialog }, chosen) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [chosen] })
  }, file)
  await openNote(page, 'Notebook/2026/2026-09-30.md')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.press('ControlOrMeta+Shift+KeyA')
  await savedStatus(page)
  await expect
    .poll(() => read('Notebook/2026/2026-09-30.md'))
    .toContain('![plate read.csv](attachments/plate%20read.csv)')
  expect(await read('Notebook/2026/attachments/plate read.csv')).toContain('A1,0.41')
})

test('panels hide and show, and the shortcuts sheet lists every shortcut', async ({ prem: { page } }) => {
  await expect(page.locator('.file-tree')).toBeVisible()
  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect(page.locator('.file-tree')).toBeHidden()
  await page.keyboard.press('ControlOrMeta+Backslash')
  await expect(page.locator('.file-tree')).toBeVisible()

  await page.keyboard.press('ControlOrMeta+Slash')
  const sheet = page.locator('.shortcuts-modal')
  await expect(sheet).toContainText('Command palette')
  await expect(sheet).toContainText('Insert date and time')
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
})

test('the application menu runs commands', async ({ prem: { app, page } }) => {
  const labels = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()!.items.map((i) => i.label))
  expect(labels).toEqual(expect.arrayContaining(['File', 'Edit', 'View', 'Go', 'Note', 'Help']))
  await app.evaluate(({ Menu, BrowserWindow }) => {
    const go = Menu.getApplicationMenu()!.items.find((i) => i.label === 'Go')!
    go.submenu!.items.find((i) => i.label === 'Go to note…')!.click(
      undefined,
      BrowserWindow.getAllWindows()[0],
      undefined as never
    )
  })
  await expect(page.locator('.palette input')).toBeFocused()
})
