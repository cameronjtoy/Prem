import path from 'node:path'
import { cp, readdir } from 'node:fs/promises'
import { expect, launch, ROOT, tempDir, test } from './fixtures'

// Vault contents, leaving out Prem's own .prem history folder.
const names = async (dir: string): Promise<string[]> => (await readdir(dir)).filter((n) => !n.startsWith('.')).sort()

test('a new note is only created once it has a name and you press Enter', async ({ prem: { page, vault } }) => {
  const before = await names(vault)
  await page.getByTitle(/^New note \(/).click()
  const input = page.locator('.tree-row.draft input')
  await expect(input).toBeFocused()
  await expect(input).toHaveAttribute('placeholder', 'Note name')

  // Clicking away drops it: nothing on disk, nothing in the list.
  await page.locator('.side-panel .pane-title').click()
  await expect(page.locator('.tree-row.draft')).toHaveCount(0)
  expect(await names(vault)).toEqual(before)

  // Esc drops it too.
  await page.getByTitle(/^New note \(/).click()
  await page.keyboard.type('Never mind')
  await page.keyboard.press('Escape')
  await expect(page.locator('.tree-row.draft')).toHaveCount(0)
  expect(await names(vault)).toEqual(before)

  // Enter creates and opens it.
  await page.getByTitle(/^New note \(/).click()
  await page.keyboard.type('Gel run')
  await page.keyboard.press('Enter')
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', 'Gel run.md')
  expect(await names(vault)).toEqual([...before, 'Gel run.md'].sort())
})

test('a name that is taken is refused, and nothing is overwritten', async ({ prem: { page, read } }) => {
  const welcome = await read('Welcome.md')
  await page.getByTitle(/^New note \(/).click()
  await page.keyboard.type('Welcome')
  await page.keyboard.press('Enter')
  await expect(page.locator('.name-error')).toHaveText('A note called "Welcome" is already here.')
  await expect(page.locator('.tree-row.draft input')).toBeFocused()
  expect(await read('Welcome.md')).toBe(welcome)
})

test('a new folder in a folder is only created on Enter', async ({ prem: { page, vault } }) => {
  await page.locator('.file-tree [title="Protocols"]').click({ button: 'right' })
  await page.locator('.context-menu').getByText('New folder', { exact: true }).click()
  await expect(page.locator('.tree-row.draft input')).toHaveAttribute('placeholder', 'Folder name')
  await page.keyboard.type('Cloning')
  await page.locator('.side-panel .pane-title').click()
  expect(await names(path.join(vault, 'Protocols'))).not.toContain('Cloning')

  await page.locator('.file-tree [title="Protocols"]').click({ button: 'right' })
  await page.locator('.context-menu').getByText('New folder', { exact: true }).click()
  await page.keyboard.type('Cloning')
  await page.keyboard.press('Enter')
  await expect(page.locator('.file-tree [title="Protocols/Cloning"]')).toBeVisible()
  expect(await names(path.join(vault, 'Protocols'))).toContain('Cloning')
})

test('the side panels close from their own buttons, reopen from the toolbar, and stay as you left them', async () => {
  const vault = await tempDir('vault')
  await cp(path.join(ROOT, 'examples', 'sample-vault'), vault, { recursive: true })
  const userData = await tempDir('settings')
  const first = await launch({ vault, userData })
  const page = first.page
  try {
    await page.getByRole('button', { name: 'Hide the file list' }).click()
    await expect(page.locator('.file-tree')).toBeHidden()
    await page.getByRole('button', { name: 'Hide links' }).click()
    await expect(page.locator('.side-panel')).toBeHidden()

    // ⌘N shows the file list again so the new note can be named.
    await page.keyboard.press('ControlOrMeta+KeyN')
    await expect(page.locator('.tree-row.draft input')).toBeFocused()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: 'Hide the file list' }).click()
    await expect(page.locator('.file-tree')).toBeHidden()
    await page.waitForTimeout(300)
  } finally {
    await first.app.close()
  }

  // Reopened, both stay hidden until shown again.
  const again = await launch({ vault, userData })
  try {
    await expect(again.page.locator('.file-tree')).toBeHidden()
    await expect(again.page.locator('.side-panel')).toBeHidden()
    await again.page.getByRole('button', { name: 'Show the file list' }).click()
    await expect(again.page.locator('.file-tree')).toBeVisible()
    await again.page.getByRole('button', { name: 'Show links' }).click()
    await expect(again.page.locator('.side-panel')).toBeVisible()
  } finally {
    await again.app.close()
  }
})
