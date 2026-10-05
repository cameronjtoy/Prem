import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { expect, openNote, test } from './fixtures'

const field = (text: string, key: string): string | undefined =>
  new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1]?.trim()

test('the Samples view lists, sorts and filters every sample', { tag: '@smoke' }, async ({ prem: { page } }) => {
  await page.getByRole('tab', { name: 'Samples' }).click()
  const table = page.locator('.sample-table')
  const ids = table.locator('tbody tr td:first-child')
  // Used up samples are hidden until asked for.
  await expect(ids).toHaveCount(11)
  await expect(ids.first()).toHaveText('S-0001')
  await page.getByLabel('Show used up and discarded').check()
  await expect(ids).toHaveCount(12)

  await table.getByRole('button', { name: /^ID/ }).click()
  await expect(ids.first()).toHaveText('S-0012')
  await expect(table.locator('th[aria-sort="descending"]')).toHaveText(/ID/)

  await page.getByLabel('Filter samples').fill('primer')
  await expect(ids).toHaveText(['S-0010', 'S-0009'])

  await ids.first().getByRole('button').click()
  await expect(page.locator('.sample-bar')).toContainText('Sample · S-0010')
  await expect(page.locator('.sample-bar')).toContainText('Freezer B, box 3, B2')
})

test('the freezer map shows each box, and a free place can take a new sample', async ({
  prem: { page, read, vault }
}) => {
  await page.getByRole('tab', { name: 'Samples' }).click()
  await page.getByRole('tab', { name: 'Freezers' }).click()
  await page.getByRole('tab', { name: 'Freezer B' }).click()
  const box = page.locator('.box-panel', { has: page.getByRole('heading', { name: 'box 3' }) })
  await expect(box).toContainText('8 × 12 · 7 of 96 places used')
  await expect(box.getByRole('button', { name: 'A1: S-0001, plasmid DNA' })).toBeVisible()
  // S-0011 is used up, so B3 is free again.
  await expect(box.getByRole('button', { name: 'B3: empty' })).toBeVisible()

  // The arrow keys move around the grid.
  await box.getByRole('button', { name: 'A1: S-0001, plasmid DNA' }).click()
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(box.getByRole('button', { name: 'B3: empty' })).toBeFocused()
  await expect(box.locator('.box-detail')).toContainText('B3 is free.')

  await box.getByRole('button', { name: 'New sample at B3' }).click()
  await expect(page.locator('.sample-bar')).toContainText('Sample · S-0013')
  const text = await read('Samples/S-0013.md')
  expect(field(text, 'type')).toBe('sample')
  expect(field(text, 'location')).toBe('Freezer B, box 3, B3')
  expect(field(text, 'status')).toBe('available')
  expect(await readdir(path.join(vault, 'Samples'))).toContain('S-0013.md')

  // Back on the map, the new sample is in its place.
  await page.getByRole('tab', { name: 'Samples' }).click()
  await expect(page.getByRole('button', { name: /^B3: S-0013/ })).toBeVisible()
})

test('moving a sample logs the move, and a taken place is refused', async ({ prem: { page, read } }) => {
  await openNote(page, 'Samples/S-0006.md')
  const bar = page.locator('.sample-bar')
  await expect(bar).toContainText('Freezer B, box 3, A3')

  await bar.getByRole('button', { name: 'Move…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Move sample' })
  // A1 holds S-0001. Taken places are marked unavailable, but choosing one says why rather than doing nothing.
  await dialog.getByRole('button', { name: 'A1: S-0001, plasmid DNA' }).click({ force: true })
  await expect(dialog.getByText('A1 in Freezer B, box 3 already holds S-0001.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Move', exact: true })).toBeDisabled()

  // C1 is free.
  await dialog.getByRole('button', { name: 'C1: empty' }).click()
  await expect(dialog.getByLabel('New location')).toHaveValue('Freezer B, box 3, C1')
  await dialog.getByRole('button', { name: 'Move', exact: true }).click()
  await expect(dialog).toBeHidden()
  await expect(bar).toContainText('Freezer B, box 3, C1')

  await expect.poll(async () => field(await read('Samples/S-0006.md'), 'location')).toBe('Freezer B, box 3, C1')
  const text = await read('Samples/S-0006.md')
  expect(text).toMatch(
    /## Location log\n\| When \| From \| To \| By \|\n\| --- \| --- \| --- \| --- \|\n\| \d{4}-\d\d-\d\d \d\d:\d\d \| Freezer B, box 3, A3 \| Freezer B, box 3, C1 \| \S+ \|/
  )

  // Marking it used up is logged too, and it leaves the map.
  await bar.getByLabel('Status').selectOption('used up')
  await expect.poll(async () => field(await read('Samples/S-0006.md'), 'status')).toBe('used up')
  await bar.getByRole('button', { name: 'Freezer B, box 3, C1' }).click()
  await expect(page.locator('.box-panel.focused')).toBeVisible()
  await expect(page.getByRole('button', { name: 'C1: empty' })).toBeVisible()
})

test('New sample from the command palette takes the next ID', async ({ prem: { page, read } }) => {
  await page.keyboard.press('ControlOrMeta+Shift+P')
  await page.keyboard.type('New sample')
  await page.keyboard.press('Enter')
  await expect(page.locator('.sample-bar')).toContainText('Sample · S-0013')
  expect(field(await read('Samples/S-0013.md'), 'id')).toBe('S-0013')
})
