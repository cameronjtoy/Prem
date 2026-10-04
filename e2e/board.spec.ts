import { readFile, writeFile } from 'node:fs/promises'
import { userInfo } from 'node:os'
import path from 'node:path'
import { expect, test } from './fixtures'

const JOB = 'Jobs/Plasmid prep/Plasmid prep job 2026-10-02 0930.md'
const FINISHING = 'Jobs/Plasmid prep/Plasmid prep job 2026-09-28 0900.md'

const cardSelector = (job: string) => `.board-card[data-job="${job}"]`

const field = (text: string, key: string): string | undefined =>
  new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1]?.trim()

test('the board shows jobs by stage, and dragging a card completes or sends back a stage', async ({
  prem: { page, read }
}) => {
  await page.getByRole('tab', { name: 'Board' }).click()
  const board = page.locator('.board')
  await expect(board.getByRole('combobox').first()).toHaveValue('Plasmid prep')
  const column = (name: string) => board.locator(`.board-column[data-column="${name}"]`)
  await expect(board.locator('.board-column h3')).toHaveText([/^Grow culture/, /^Miniprep/, /^Sequence check/])
  const card = (job: string) => board.locator(cardSelector(job))
  await expect(column('Grow culture').locator(cardSelector(JOB))).toBeVisible()
  await expect(column('Sequence check').locator(cardSelector(FINISHING))).toBeVisible()
  await expect(card(JOB)).toContainText('bob')

  // Drag to the next stage: asks, then hands the job to Miniprep's assignee.
  page.once('dialog', (dialog) => {
    expect(dialog.message()).toBe('Complete Grow culture and hand the job to alice (Miniprep)?')
    void dialog.accept()
  })
  await card(JOB).dragTo(column('Miniprep'))
  await expect(column('Miniprep').locator(cardSelector(JOB))).toBeVisible()
  const moved = await read(JOB)
  expect(field(moved, 'stage')).toBe('Miniprep')
  expect(field(moved, 'assignee')).toBe('alice')
  expect(moved).toMatch(/\| Grow culture \| +\| \S+ \| \d{4}-\d\d-\d\d \d\d:\d\d \| \d{4}-\d\d-\d\d \d\d:\d\d \|/)

  // A column that's neither next nor earlier can't take it.
  await card(JOB).dragTo(column('Sequence check'))
  await expect(column('Miniprep').locator(cardSelector(JOB))).toBeVisible()

  // Drag back: asks why, then sends it back with a note.
  await card(JOB).dragTo(column('Grow culture'))
  const form = page.getByRole('dialog', { name: 'Send back' })
  await form.getByRole('textbox').fill('culture was contaminated')
  await form.getByRole('button', { name: 'Send back' }).click()
  await expect(column('Grow culture').locator(cardSelector(JOB))).toBeVisible()
  const back = await read(JOB)
  expect(field(back, 'stage')).toBe('Grow culture')
  expect(back).toMatch(/sent the job back to Grow culture: culture was contaminated/)

  // Filter by assignee.
  await board.getByLabel('Assigned to').selectOption('alice')
  await expect(board.locator('.board-card')).toHaveCount(1)
  await expect(card(FINISHING)).toBeVisible()

  // Cards open their job.
  await card(FINISHING).getByRole('button').first().click()
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', FINISHING)
})

test('My tasks counts the jobs waiting on you and opens them', async ({ prem: { page, vault } }) => {
  const me = userInfo().username
  const text = await readFile(path.join(vault, JOB), 'utf8')
  await writeFile(path.join(vault, JOB), text.replace('assignee: bob', `assignee: ${me}`))
  const button = page.getByRole('button', { name: /My tasks/ })
  await expect(button.locator('.badge')).toHaveText('1')
  await button.click()
  const list = page.getByRole('dialog', { name: 'My tasks' })
  await expect(list).toContainText('Plasmid prep · Grow culture')
  await list.getByRole('button', { name: /Grow culture/ }).click()
  await expect(page.locator('.breadcrumb')).toHaveAttribute('title', JOB)
  await expect(list).toBeHidden()
})

test('a signed job stays where it is on the board', async ({ prem: { page } }) => {
  expect((await page.evaluate((p) => window.api.record.sign(p), FINISHING)).ok).toBe(true)
  await page.getByRole('tab', { name: 'Board' }).click()
  const card = page.locator(`.board-card[data-job="${FINISHING}"]`)
  await expect(card).toHaveAttribute('draggable', 'false')
  await expect(card).toHaveAttribute('title', /signed/)
  await expect(card.getByRole('button', { name: /Complete/ })).toHaveCount(0)
})

test('a job changed in another app shows on an open board, even after its signing status was checked', async ({
  prem: { page, vault }
}) => {
  // Opening the board checks each job's signing status, which records an outside edit before the watcher
  // reports it. The change must still reach the board.
  await page.getByRole('tab', { name: 'Board' }).click()
  const text = await readFile(path.join(vault, JOB), 'utf8')
  await writeFile(path.join(vault, JOB), text.replace('assignee: bob', 'assignee: carol'))
  await page.getByRole('tab', { name: 'Note' }).click()
  await page.getByRole('tab', { name: 'Board' }).click()
  await expect(page.locator(cardSelector(JOB)).locator('.board-chip')).toHaveText('carol')
})
