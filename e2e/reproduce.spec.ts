import { execFileSync } from 'node:child_process'
import { readFile, readdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, openNote, savedStatus, tempDir, test } from './fixtures'

const NOTE = 'Notebook/2026/Plate analysis.md'
const PLATE = 'Notebook/2026/attachments/plate.csv'

/** A tiny package as a wheel, so building environments needs no network. */
function makeWheel(dir: string): string {
  const wheel = path.join(dir, 'premtiny-1.0-py3-none-any.whl')
  execFileSync('python3', [
    '-c',
    `import zipfile, sys
with zipfile.ZipFile(sys.argv[1], "w") as z:
    z.writestr("premtiny/__init__.py", "VALUE = 42\\n")
    z.writestr("premtiny-1.0.dist-info/METADATA", "Metadata-Version: 2.1\\nName: premtiny\\nVersion: 1.0\\n")
    z.writestr("premtiny-1.0.dist-info/WHEEL", "Wheel-Version: 1.0\\nGenerator: prem-test\\nRoot-Is-Purelib: true\\nTag: py3-none-any\\n")
    z.writestr("premtiny-1.0.dist-info/RECORD", "")`,
    wheel
  ])
  return wheel
}

test('outputs save their environment, flag changed inputs, and Reproduce compares a rerun', async ({
  prem: { page, read, vault }
}) => {
  test.setTimeout(240_000)
  const wheel = makeWheel(await tempDir('wheel'))
  await writeFile(path.join(vault, 'environment.txt'), `${wheel}\n`)
  await writeFile(path.join(vault, PLATE), 'well,od\nA1,0.41\nA2,0.43\n')
  await writeFile(
    path.join(vault, NOTE),
    '---\ntype: experiment\n---\n\n# Plate analysis\n\n```python {run}\nimport premtiny\nrows = open("attachments/plate.csv").read().splitlines()[1:]\n```\n\nThen:\n\n```python {run}\nprint(premtiny.VALUE, len(rows), "wells")\n```\n'
  )
  await openNote(page, NOTE)
  await page.locator('.cm-cell-run').nth(0).dispatchEvent('mousedown')
  await expect(page.locator('.cm-cell-output')).toHaveCount(1, { timeout: 180_000 })
  await page.locator('.cm-cell-run').nth(1).dispatchEvent('mousedown')
  await expect(page.locator('.cm-cell-text')).toHaveText('42 2 wells', { timeout: 60_000 })
  await savedStatus(page)

  // The environment's full package list is saved next to the note, named by the id the output records.
  const env = /env=([0-9a-f]{12})/.exec(await read(NOTE))![1]
  const files = await readdir(path.join(vault, 'Notebook/2026/attachments'))
  expect(files).toContain(`environment-${env}.txt`)
  const lock = await readFile(path.join(vault, `Notebook/2026/attachments/environment-${env}.txt`), 'utf8')
  expect(lock).toMatch(/^# python==3\.\d+\.\d+$/m)
  expect(lock).toMatch(/^premtiny @ /m)

  // The vault moves on: environment.txt no longer lists the package. Reproduce still rebuilds the old one.
  await writeFile(path.join(vault, 'environment.txt'), '# nothing yet\n')
  const reproduce = page.locator('.cm-cell-reproduce').nth(1)
  await reproduce.dispatchEvent('mousedown')
  const report = page.getByRole('dialog', { name: 'Reproduce' })
  await expect(report).toBeVisible({ timeout: 180_000 })
  await expect(report.locator('.reproduce-headline')).toHaveText('All 2 outputs are the same as recorded.')
  await expect(report.locator('.reproduce-env')).toContainText(`Rebuilt environment ${env} exactly`)
  await expect(report.locator('.reproduce-cells > li')).toHaveCount(2)
  await expect(report.locator('.reproduce-verdict').nth(1)).toHaveText('Same')
  await report.getByRole('button', { name: 'Close' }).click()

  // A file the output read changes: the output is flagged, and Reproduce shows what differs.
  await writeFile(path.join(vault, PLATE), 'well,od\nA1,0.41\nA2,0.43\nA3,0.40\n')
  await expect(page.locator('.cm-cell-status').nth(0)).toContainText('plate.csv changed since this output')
  await expect(page.locator('.cm-cell-status').nth(1)).toHaveText(
    'An earlier cell read a file that changed since this output.'
  )
  await reproduce.dispatchEvent('mousedown')
  await expect(report.locator('.reproduce-headline')).toHaveText('1 of 2 outputs differ from what was recorded.', {
    timeout: 120_000
  })
  await expect(report.locator('.reproduce-cells > li').nth(1)).toContainText('Printed text: different')
  await expect(report.locator('.reproduce-cells > li').nth(0)).toContainText(
    'It read different contents of plate.csv than the original run.'
  )
  await report.getByRole('button', { name: 'Close' }).click()

  // Signed records can't be run, but they can still be reproduced: nothing in them changes.
  const before = await read(NOTE)
  await writeFile(path.join(vault, PLATE), 'well,od\nA1,0.41\nA2,0.43\n')
  await page.locator('.record-bar').getByRole('button', { name: 'Sign…' }).click()
  await page.getByRole('button', { name: 'Sign and lock' }).click()
  await expect(page.locator('.save-status')).toHaveText('Locked')
  await expect(page.locator('.cm-cell-run').nth(0)).toBeDisabled()
  await reproduce.dispatchEvent('mousedown')
  await expect(report.locator('.reproduce-headline')).toHaveText('All 2 outputs are the same as recorded.', {
    timeout: 120_000
  })
  expect(await read(NOTE)).toBe(before)
  await rm(path.join(vault, 'environment.txt'))
})
