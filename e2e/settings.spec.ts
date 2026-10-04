import path from 'node:path'
import { cp, readFile, writeFile } from 'node:fs/promises'
import { expect, launch, openNote, ROOT, tempDir, test } from './fixtures'

const readJson = async (file: string): Promise<Record<string, unknown>> => JSON.parse(await readFile(file, 'utf8'))

test('changing a setting on the Settings screen saves it to settings.json and applies it', async ({
  prem: { page, userData }
}) => {
  const file = path.join(userData, 'settings.json')
  await openNote(page, 'Welcome.md')
  await page.keyboard.press('ControlOrMeta+Comma')
  const settings = page.locator('.settings-page')
  await expect(settings.locator('.settings-search')).toBeFocused()

  const size = settings.locator('[data-setting="appearance.textSize"]')
  await size.locator('input').fill('20')
  await size.locator('input').press('Enter')
  await expect(size).toContainText('Modified')
  await expect.poll(() => readJson(file)).toEqual({ 'appearance.textSize': 20 })

  const lines = settings.locator('[data-setting="editor.lineNumbers"]')
  await lines.locator('input').click()
  await expect(lines.locator('input')).toBeChecked()
  await expect.poll(() => readJson(file)).toEqual({ 'appearance.textSize': 20, 'editor.lineNumbers': true })

  // Out of range: refused with a reason, and the file is left alone.
  await size.locator('input').fill('99')
  await size.locator('input').press('Enter')
  await expect(size.locator('.setting-error')).toContainText('between 12 and 28')
  // The first Esc puts the box back; the next closes Settings.
  await page.keyboard.press('Escape')
  await expect(size.locator('input')).toHaveValue('20')
  await page.keyboard.press('Escape')
  await expect(settings).toBeHidden()
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '20px')
  await expect(page.locator('.cm-lineNumbers')).toBeVisible()

  // Reset puts the default back and removes it from the file.
  await page.keyboard.press('ControlOrMeta+Comma')
  await size.getByRole('button', { name: 'Reset' }).click()
  await expect.poll(() => readJson(file)).toEqual({ 'editor.lineNumbers': true })
  await expect(size).not.toContainText('Modified')
})

test('editing settings.json applies straight away', { tag: '@smoke' }, async ({ prem: { app, page, userData } }) => {
  const file = path.join(userData, 'settings.json')
  const dark = () => page.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches)
  // Playwright pins pages to light mode by default; let the app's theme through.
  await page.emulateMedia({ colorScheme: null })

  await writeFile(file, JSON.stringify({ 'appearance.theme': 'dark' }))
  await expect.poll(dark).toBe(true)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(38, 38, 36)')
  expect(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource)).toBe('dark')

  await writeFile(file, JSON.stringify({ 'appearance.theme': 'light' }))
  await expect.poll(dark).toBe(false)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 249, 245)')
})

test('the font in notes can be the serif, while headings always are', async ({ prem: { page, userData } }) => {
  await openNote(page, 'Welcome.md')
  const scroller = page.locator('.cm-scroller')
  await expect(scroller).toHaveCSS('font-family', /^"Inter Variable"/)
  await expect(page.locator('.cm-md-h1').first()).toHaveCSS('font-family', /^"Source Serif 4 Variable"/)

  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ 'appearance.noteFont': 'serif' }))
  await expect(scroller).toHaveCSS('font-family', /^"Source Serif 4 Variable"/)
  // The bundled font is the one that's drawn, not a system fallback.
  expect(await page.evaluate(() => document.fonts.check('16px "Source Serif 4 Variable"'))).toBe(true)
})

test('a mistake in settings.json is reported, and the last good settings stay in use', async ({
  prem: { page, userData }
}) => {
  const file = path.join(userData, 'settings.json')
  await writeFile(file, JSON.stringify({ 'appearance.textSize': 22 }))
  await openNote(page, 'Welcome.md')
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '22px')

  await writeFile(file, '{\n  "appearance.textSize": 18,\n}\n')
  const banner = page.locator('.settings-trouble')
  await expect(banner).toContainText('settings.json has a mistake at line 3')
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '22px')

  await banner.getByRole('button', { name: 'Show' }).click()
  await expect(page.locator('.settings-page .banner.error')).toContainText('line 3')
  // Changing a setting now would overwrite the broken file, so it's refused.
  const size = page.locator('[data-setting="appearance.textSize"]')
  await size.locator('input').fill('24')
  await size.locator('input').press('Enter')
  await expect(size.locator('.setting-error')).toContainText('has a mistake')

  await writeFile(file, '{ "appearance.textSize": 18, "appearance.font": "Comic Sans" }')
  await expect(page.locator('.settings-page .banner.warning')).toContainText('Unknown setting "appearance.font"')
  await expect(page.locator('.settings-page .banner.error')).toBeHidden()
  await page.keyboard.press('Escape')
  await expect(page.locator('.cm-editor')).toHaveCSS('font-size', '18px')
})

test("the notebook folder setting decides where today's entry goes", async ({ prem: { page, userData } }) => {
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ 'notebook.folder': 'Lab book' }))
  await page.keyboard.press('ControlOrMeta+Comma')
  await expect(page.locator('[data-setting="notebook.folder"] input')).toHaveValue('Lab book')
  await page.keyboard.press('Escape')
  await page.keyboard.press('ControlOrMeta+KeyT')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', /^Lab book\/\d{4}\/\d{4}-\d\d-\d\d\.md$/)
})

test('Settings opens from the welcome screen, and Open settings.json creates the file', async () => {
  const { app, page, userData } = await launch()
  try {
    await page.keyboard.press('ControlOrMeta+Comma')
    await page.getByRole('button', { name: 'Open settings.json' }).click()
    const file = path.join(userData, 'settings.json')
    await expect.poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened)).toEqual([file])
    expect(await readJson(file)).toEqual({})
  } finally {
    await app.close()
  }
})

test('the last vault is moved out of settings.json written by earlier versions', async () => {
  const vault = await tempDir('vault')
  await cp(path.join(ROOT, 'examples', 'sample-vault'), vault, { recursive: true })
  const userData = await tempDir('settings')
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ lastVault: vault }))
  const { app, page } = await launch({ userData })
  try {
    await expect(page.locator('.file-tree')).toBeVisible()
    expect(await readJson(path.join(userData, 'settings.json'))).toEqual({})
    expect(await readJson(path.join(userData, 'state.json'))).toEqual({ lastVault: expect.any(String) })
  } finally {
    await app.close()
  }
})
