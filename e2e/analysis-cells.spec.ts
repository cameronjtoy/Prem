import path from 'node:path'
import { readdir, writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { approve, expect, openNote, savedStatus, test } from './fixtures'

const NOTE = 'Notebook/2026/Plate analysis.md'

async function writeNote(vault: string, ...cells: string[]): Promise<void> {
  const body = cells.map((code) => `\`\`\`python {run}\n${code}\n\`\`\`\n`).join('\nSome text.\n\n')
  await writeFile(path.join(vault, NOTE), `# Plate analysis\n\n${body}`)
}

const runButton = (page: Page, n = 0) => page.locator('.cm-cell-run').nth(n)
const run = (page: Page, n = 0) => runButton(page, n).dispatchEvent('mousedown')

test('Run writes the output under the cell, with what produced it', async ({ prem: { page, read, vault } }) => {
  await writeFile(path.join(vault, 'Notebook/2026/attachments/plate.csv'), 'well,od\nA1,0.41\nA2,0.43\n')
  await writeNote(
    vault,
    'import csv\nrows = list(csv.DictReader(open("attachments/plate.csv")))\nprint(len(rows), "wells")'
  )
  await openNote(page, NOTE)
  await expect(page.locator('.cm-cell-status')).toHaveText('Not run yet')
  await run(page)
  // The code was written to the note outside Prem, so it's shown before it runs, once.
  await approve(page)

  const output = page.locator('.cm-cell-output')
  await expect(output.locator('.cm-cell-text')).toHaveText('2 wells')
  await expect(output.locator('.cm-cell-meta')).toContainText(/Ran .* · Python 3\.\d+.* · read plate\.csv/)
  await savedStatus(page)
  const text = await read(NOTE)
  expect(text).toMatch(
    /```\n<!-- prem:output code=[0-9a-f]{16} ran=\S+ by=\S+ took=[\d.]+ python=3\.\d+\.\d+ env=- inputs=Notebook\/2026\/attachments\/plate\.csv@[0-9a-f]{12} -->\n```text\n2 wells\n```\n<!-- \/prem:output -->\n/
  )

  // Running again replaces the output rather than adding another.
  await run(page)
  await savedStatus(page)
  await expect.poll(async () => (await read(NOTE)).match(/prem:output code/g)?.length).toBe(1)
})

test('figures and tables are saved as attachments and shown', async ({ prem: { page, read, vault } }) => {
  await writeNote(
    vault,
    'import pandas as pd\nimport matplotlib.pyplot as plt\ndf = pd.DataFrame({"sample": ["S1", "S2"], "od": [0.42, 0.9]})\ndf.plot.bar(x="sample", y="od")\ndf'
  )
  await openNote(page, NOTE)
  await run(page)
  await approve(page)
  const output = page.locator('.cm-cell-output')
  await expect(output.locator('img')).toBeVisible({ timeout: 30_000 })
  await expect(output.locator('table')).toContainText('S2')
  await savedStatus(page)
  const files = await readdir(path.join(vault, 'Notebook/2026/attachments'))
  expect(files).toEqual(expect.arrayContaining([expect.stringMatching(/^analysis-[0-9a-f]{8}-figure-1\.png$/)]))
  expect(files).toEqual(expect.arrayContaining([expect.stringMatching(/^analysis-[0-9a-f]{8}-table-1\.csv$/)]))
  const text = await read(NOTE)
  expect(text).toMatch(/!\[Table: 2 rows × 2 columns\]\(attachments\/analysis-[0-9a-f]{8}-table-1\.csv\)/)
  expect(text).toMatch(/!\[Figure 1\]\(attachments\/analysis-[0-9a-f]{8}-figure-1\.png\)/)
})

test('cells share variables, ⇧↵ runs the cell you are in, and changed code is flagged', async ({
  prem: { page, read, vault }
}) => {
  await writeNote(vault, 'x = 20', 'x * 2')
  await openNote(page, NOTE)
  await run(page, 0)
  await approve(page)
  await expect(page.locator('.cm-cell-output')).toHaveCount(1)
  await page.locator('.cm-line', { hasText: 'x * 2' }).click()
  await page.keyboard.press('Shift+Enter')
  await approve(page)
  await expect(page.locator('.cm-cell-output').nth(1).locator('.cm-cell-text')).toHaveText('40')
  await savedStatus(page)
  expect(await read(NOTE)).toContain('x * 2\n```\n<!-- prem:output')

  await page.locator('.cm-line', { hasText: 'x = 20' }).click()
  await page.keyboard.press('End')
  await page.keyboard.type('0')
  await expect(page.locator('.cm-cell-status').first()).toContainText('The code changed since this output')
})

test('errors are recorded, and Stop and Run all work', async ({ prem: { page, read, vault } }) => {
  await writeNote(vault, 'n = 1', 'import time\ntime.sleep(30)', '1 / 0')
  await openNote(page, NOTE)
  await run(page, 2)
  await approve(page)
  await expect(page.locator('.cm-cell-text.error')).toContainText('ZeroDivisionError')
  await savedStatus(page)
  expect(await read(NOTE)).toMatch(/ ok=no [\s\S]*```text \{error\}\nTraceback/)

  await run(page, 1)
  await approve(page)
  await expect(page.locator('.cm-cell-stop')).toBeVisible()
  await page.locator('.cm-cell-stop').dispatchEvent('mousedown')
  await expect(page.locator('.cm-cell-output').filter({ hasText: 'Stopped before it finished' })).toBeVisible()
})

test('Run all starts Python afresh and runs every cell in order', async ({ prem: { page, read, vault } }) => {
  await writeNote(vault, 'n = 1', 'n + 1', 'n + 2')
  await openNote(page, NOTE)
  await page.locator('.cm-line', { hasText: 'Plate analysis' }).click()
  await page.keyboard.press('ControlOrMeta+Alt+Enter')
  // Run all asks once, for every cell.
  await expect(page.locator('.approve-cell')).toHaveCount(3)
  await approve(page)
  await expect(page.locator('.cm-cell-output')).toHaveCount(3)
  await expect(page.locator('.cm-cell-output').nth(2).locator('.cm-cell-text')).toHaveText('3')
  await savedStatus(page)
  expect((await read(NOTE)).match(/```text\n(\d)\n```/g)).toEqual(['```text\n2\n```', '```text\n3\n```'])
})

test('signed notes cannot run their cells, and a cell that runs too long is stopped', async ({
  prem: { page, userData, vault }
}) => {
  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ 'analysis.timeout': 5 }))
  await writeNote(vault, 'import time\ntime.sleep(60)')
  await openNote(page, NOTE)
  await run(page)
  await approve(page)
  await expect(page.locator('.cm-cell-status.failed')).toContainText('Stopped after 5 s', { timeout: 15_000 })

  expect((await page.evaluate((p) => window.api.record.sign(p), NOTE)).ok).toBe(true)
  await openNote(page, 'Welcome.md')
  await openNote(page, NOTE)
  await expect(runButton(page)).toBeDisabled()
  await expect(runButton(page)).toHaveAttribute('title', /read-only/)
})
