import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { answerSaveDialog, expect, menuItem, openNote, rename, reveal, savedStatus, tempDir, test } from './fixtures'

const PROTOCOL = 'Protocols/Plasmid miniprep.md'
const EXPERIMENT = 'Notebook/2026/Ligation of insert into pUC19.md'

test('runs a protocol: timestamps steps and completes the run', async ({ prem: { page, read } }) => {
  await openNote(page, PROTOCOL)
  await page
    .locator('.run-bar')
    .getByRole('button', { name: /Start run/ })
    .click()
  await expect(page.locator('.run-bar')).toContainText('Run in progress')
  const runPath = (await page.locator('.breadcrumb').getAttribute('title'))!
  expect(runPath).toMatch(/^Notebook\/Runs\/\d{4}\/Plasmid miniprep run /)

  await page.locator('.cm-task-checkbox').first().click()
  await savedStatus(page)
  await expect.poll(() => read(runPath)).toMatch(/1\. \[x\] .*✓ \d\d:\d\d/)

  page.once('dialog', (dialog) => void dialog.accept())
  await page
    .locator('.run-bar')
    .getByRole('button', { name: /Complete/ })
    .click()
  await expect(page.locator('.run-bar')).toContainText('Completed run')
  await savedStatus(page)
  await expect.poll(() => read(runPath)).toMatch(/status: complete/)
})

test('keeps every version and restores an old one', async ({ prem: { page, read } }) => {
  await openNote(page, 'Samples/S-0001.md')
  const original = await read('Samples/S-0001.md')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nMoved to box 4.')
  await savedStatus(page)
  await expect.poll(() => read('Samples/S-0001.md')).toContain('Moved to box 4.')

  await page.getByTitle(/^History/).click()
  const versions = page.locator('.history-list li')
  await expect(versions).toHaveCount(2)
  await versions.last().click()
  await page.locator('.history-actions .primary-button').click()
  await savedStatus(page)
  await expect.poll(() => read('Samples/S-0001.md')).toBe(original)
})

test('signs a record, locks it, and only changes it through an amendment', async ({ prem: { page, read } }) => {
  await openNote(page, EXPERIMENT)
  await page.locator('.record-bar').getByRole('button', { name: 'Sign…' }).click()
  await page.locator('.record-form input').fill('Gel reviewed')
  await page.getByRole('button', { name: 'Sign and lock' }).click()
  await expect(page.locator('.save-status')).toHaveText('Locked')
  await expect(page.locator('.record-bar')).toContainText('Gel reviewed')

  const signed = await read(EXPERIMENT)
  await page.locator('.cm-content').focus()
  await page.keyboard.type('sneaky edit')
  await page.waitForTimeout(1000)
  expect(await read(EXPERIMENT)).toBe(signed)

  await page.locator('.record-bar').getByRole('button', { name: 'Amend…' }).click()
  await page.locator('.record-form input').fill('Lane 4 was primer dimer')
  await page.getByRole('button', { name: 'Unlock to amend' }).click()
  await page.locator('.cm-content').focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type(' Correction: lane 4 is primer dimer.')
  await savedStatus(page)
  await expect(page.locator('.record-bar')).toContainText('Amended')
  await expect(page.locator('.record-bar')).toContainText('Lane 4 was primer dimer')
})

test('exports a signed entry and a whole folder as PDF', async ({ prem: { app, page } }) => {
  const out = await tempDir('pdf')
  await openNote(page, EXPERIMENT)
  await page.locator('.record-bar').getByRole('button', { name: 'Sign…' }).click()
  await page.getByRole('button', { name: 'Sign and lock' }).click()
  await expect(page.locator('.save-status')).toHaveText('Locked')

  await answerSaveDialog(app, path.join(out, 'ligation'))
  await page.keyboard.press('ControlOrMeta+p')
  await expect(page.locator('.banner.info')).toContainText('Exported to')
  const pdf = await readFile(path.join(out, 'ligation.pdf'))
  expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')

  await page.locator('.banner button').click()
  await answerSaveDialog(app, path.join(out, 'notebook.pdf'))
  await reveal(page, 'Notebook/2026')
  await page.locator('.file-tree [title="Notebook"]').click({ button: 'right' })
  await menuItem(page, 'Export as PDF…').click()
  await expect(page.locator('.banner.info')).toContainText(/Exported \d+ entries/)
  expect((await readFile(path.join(out, 'notebook.pdf'))).length).toBeGreaterThan(pdf.length)
})

test('renaming a protocol updates the links to it, but never a signed note', async ({ prem: { page, read } }) => {
  await openNote(page, EXPERIMENT)
  await page.locator('.record-bar').getByRole('button', { name: 'Sign…' }).click()
  await page.getByRole('button', { name: 'Sign and lock' }).click()
  await expect(page.locator('.save-status')).toHaveText('Locked')
  const signed = await read(EXPERIMENT)

  await rename(page, PROTOCOL, 'Miniprep (Qiagen)')
  await expect(page.locator('.banner')).toContainText('Updated links in 4 notes')
  await expect(page.locator('.banner')).toContainText(
    '1 signed note still links to the old name: Ligation of insert into pUC19'
  )
  expect(await read('Notebook/Runs/2026/Plasmid miniprep run 2026-09-29 1410.md')).toContain(
    'protocol: "[[Miniprep (Qiagen)]]"'
  )
  expect(await read(EXPERIMENT)).toBe(signed)
})
