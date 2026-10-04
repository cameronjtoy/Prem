import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { expect, launch, openNote, savedStatus, tempDir, test } from './fixtures'

test('shows the welcome screen when no vault is open', async () => {
  const { app, page } = await launch()
  await expect(page.locator('.welcome-card')).toContainText('Open a folder as a vault')
  await expect(page.locator('.connect-form')).toBeVisible()
  await app.close()
})

test('opens the example vault with every link resolving', { tag: '@smoke' }, async ({ prem: { page } }) => {
  await openNote(page, 'Welcome.md')
  await expect(page.locator('.cm-wikilink').first()).toBeVisible()
  await expect(page.locator('.cm-wikilink-unresolved')).toHaveCount(0)
})

test('creates an entry from a template and saves it to disk', { tag: '@smoke' }, async ({ prem: { page, read } }) => {
  await page.locator('.main-toolbar').getByRole('button', { name: 'New from template' }).click()
  await page.locator('.modal input').fill('PCR check')
  await page.locator('.template-list li', { hasText: 'Experiment' }).click()
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', /PCR check\.md$/)
  const notePath = (await page.locator('.breadcrumb').getAttribute('title'))!
  // A new note focuses its editor once it has loaded; typing before then would go nowhere.
  await expect(page.locator('.cm-content')).toBeFocused()
  await page.keyboard.type('Band at 1.2 kb in lanes 2 to 4.')
  await savedStatus(page)
  const text = await read(notePath)
  expect(text).toMatch(/^---\ntype: experiment/)
  expect(text).toContain('Band at 1.2 kb in lanes 2 to 4.')
})

test("opens today's entry with ⌘T, filed by year", async ({ prem: { page, vault } }) => {
  const now = new Date()
  const day = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((n) => String(n).padStart(2, '0')).join('-')
  await page.keyboard.press('ControlOrMeta+t')
  const expected = `Notebook/${now.getFullYear()}/${day}.md`
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', expected)
  await expect
    .poll(() =>
      stat(path.join(vault, expected)).then(
        () => true,
        () => false
      )
    )
    .toBe(true)
})

test('finds text across the vault and opens the match', { tag: '@smoke' }, async ({ prem: { page } }) => {
  await page.keyboard.press('ControlOrMeta+k')
  await page.locator('.search-input').fill('ligase')
  await expect(page.locator('.search-results li').first()).toContainText('Ligation of insert into pUC19')
  await page.keyboard.press('Enter')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', 'Notebook/2026/Ligation of insert into pUC19.md')
})

test(
  'attaches a dropped file next to the note and shows it',
  { tag: '@smoke' },
  async ({ prem: { page, vault, read } }) => {
    await openNote(page, 'Notebook/2026/2026-09-30.md')
    const png = await readFile(path.join(vault, 'Notebook/2026/attachments/gel 2026-09-30.png'))
    await page.locator('.cm-content').focus()
    await page.keyboard.press('ControlOrMeta+End')
    // Drop a file the way the operating system would.
    await page.locator('.cm-content').evaluate(
      (target, bytes) => {
        const transfer = new DataTransfer()
        transfer.items.add(new File([new Uint8Array(bytes)], 'western blot.png', { type: 'image/png' }))
        const box = target.getBoundingClientRect()
        target.dispatchEvent(
          new DragEvent('drop', {
            dataTransfer: transfer,
            bubbles: true,
            cancelable: true,
            clientX: box.left + 10,
            clientY: box.bottom - 5
          })
        )
      },
      [...png]
    )
    await savedStatus(page)
    await expect
      .poll(() => read('Notebook/2026/2026-09-30.md'))
      .toContain('![western blot.png](attachments/western%20blot.png)')
    const saved = await readFile(path.join(vault, 'Notebook/2026/attachments/western blot.png'))
    expect(saved.equals(png)).toBe(true)
  }
)

test('previews an attached Jupyter notebook without running it', async ({ prem: { app, page } }) => {
  await openNote(page, 'Notebook/2026/2026-09-30.md')
  const preview = page.locator('.cm-attachment-notebook')
  await expect(preview.locator('.nb-header')).toContainText('Growth curve analysis.ipynb')
  await expect(preview.locator('.nb-cell')).toHaveCount(6)
  await expect(preview.locator('.nb-html table')).toBeVisible()
  await expect(preview.locator('.nb-image')).toBeVisible()
  await expect(preview.locator('.nb-text').first()).toContainText('doubling time')
  await preview.locator('.nb-open').click()
  await expect
    .poll(() => app.evaluate(() => (globalThis as unknown as { opened: string[] }).opened))
    .toEqual([expect.stringMatching(/Growth curve analysis\.ipynb$/)])
})

test('offers a starting point in a new, empty vault', async () => {
  const vault = await tempDir('empty')
  const { app, page } = await launch({ vault })
  await expect(page.locator('.file-tree [title="templates"]')).toBeVisible()
  await expect(page.locator('.empty-state')).toContainText('What are you working on?')
  await expect(page.getByRole('button', { name: 'Write a protocol' })).toBeVisible()
  await page.getByRole('button', { name: /Today's entry/ }).click()
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', /^Notebook\/\d{4}\/\d{4}-\d\d-\d\d\.md$/)
  await app.close()
})

test('shows backlinks as readable text', async ({ prem: { page } }) => {
  await openNote(page, 'Notebook/2026/Ligation of insert into pUC19.md')
  const welcome = page.locator('.side-panel .snippet').filter({ hasText: 'Notebook:' })
  await expect(welcome.first()).toBeVisible()
  await expect(page.locator('.side-panel .snippet').filter({ hasText: '**' })).toHaveCount(0)
})
