import { readdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { approvalDialog, approve, expect, makeWheel, openNote, savedStatus, tempDir, test } from './fixtures'

const NOTE = 'Notebook/2026/Safety.md'
const runButton = (page: import('@playwright/test').Page, n = 0) => page.locator('.cm-cell-run').nth(n)

const envs = async (userData: string): Promise<string[]> => readdir(path.join(userData, 'envs')).catch(() => [])

test('code from outside Prem is shown before it runs, and asked about again when it changes', async ({
  prem: { page, read, vault }
}) => {
  const file = path.join(vault, NOTE)
  await writeFile(file, '# Safety\n\n```python {run}\nprint("from disk")\n```\n')
  await openNote(page, NOTE)

  // Cancel: nothing runs.
  await runButton(page).dispatchEvent('mousedown')
  await expect(approvalDialog(page).locator('.approve-cell')).toHaveText('print("from disk")')
  await expect(approvalDialog(page)).toContainText('changed outside Prem')
  await approve(page, 'cancel')
  await expect(page.locator('.cm-cell-output')).toHaveCount(0)

  // Run: it runs, and running the same code again doesn't ask.
  await runButton(page).dispatchEvent('mousedown')
  await approve(page)
  await expect(page.locator('.cm-cell-text')).toHaveText('from disk')
  await savedStatus(page)
  await runButton(page).dispatchEvent('mousedown')
  await savedStatus(page)
  await expect(approvalDialog(page)).toHaveCount(0)

  // Code you type yourself runs without asking.
  await page.locator('.cm-line', { hasText: 'print("from disk")' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('\nprint("typed")')
  await runButton(page).dispatchEvent('mousedown')
  await expect(page.locator('.cm-cell-text')).toHaveText('from disk\ntyped')
  await expect(approvalDialog(page)).toHaveCount(0)
  await savedStatus(page)

  // The file changes on disk (a sync, another program): the new code is shown first.
  const text = await read(NOTE)
  await writeFile(file, text.replace('print("typed")', 'print("changed elsewhere")'))
  await expect(page.locator('.cm-line', { hasText: 'changed elsewhere' })).toBeVisible()
  await runButton(page).dispatchEvent('mousedown')
  await expect(approvalDialog(page).locator('.approve-cell')).toContainText('print("changed elsewhere")')
  await approve(page, 'cancel')
  await expect(page.locator('.cm-cell-text')).toHaveText('from disk\ntyped')
})

test('packages are installed only once approved, and asked about again when the list changes', async ({
  prem: { page, vault, userData }
}) => {
  test.setTimeout(180_000)
  const dir = await tempDir('wheels')
  const first = makeWheel(dir, 'premone')
  const second = makeWheel(dir, 'premtwo')
  await writeFile(path.join(vault, 'environment.txt'), `${first}\n`)
  await writeFile(path.join(vault, NOTE), '# Safety\n\n```python {run}\nimport premone\nprint(premone.VALUE)\n```\n')
  await openNote(page, NOTE)

  // Cancel: no environment is built.
  await runButton(page).dispatchEvent('mousedown')
  const dialog = approvalDialog(page)
  await expect(dialog.getByRole('button', { name: 'Install and run' })).toBeVisible()
  await expect(dialog.locator('.approve-package')).toContainText('premone-1.0-py3-none-any.whl')
  await approve(page, 'cancel')
  expect(await envs(userData)).toEqual([])

  await runButton(page).dispatchEvent('mousedown')
  await approve(page)
  await expect(page.locator('.cm-cell-text')).toHaveText('42', { timeout: 120_000 })
  await savedStatus(page)

  // A comment doesn't change what's installed, so it isn't asked about.
  await writeFile(path.join(vault, 'environment.txt'), `# the lab's packages\n${first}\n`)
  await runButton(page).dispatchEvent('mousedown')
  await savedStatus(page)
  await expect(approvalDialog(page)).toHaveCount(0)

  // A new package is: the dialog shows just what was added.
  await writeFile(path.join(vault, 'environment.txt'), `${first}\n${second}\n`)
  await runButton(page).dispatchEvent('mousedown')
  await expect(dialog.getByRole('button', { name: 'Install' })).toBeVisible()
  await expect(dialog).toContainText('environment.txt changed')
  await expect(dialog.locator('.approve-package')).toHaveCount(1)
  await expect(dialog.locator('.approve-package.added')).toContainText('premtwo-1.0-py3-none-any.whl')
  await approve(page)
  await expect(page.locator('.cm-cell-status')).not.toContainText('Running', { timeout: 120_000 })
})
