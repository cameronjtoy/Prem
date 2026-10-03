import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import { expect, openNote, ROOT, test } from './fixtures'

const run = promisify(execFile)
const python = process.platform === 'win32' ? 'python' : 'python3'

// The prem package (python/) writing to a vault while Prem has it open.
test('a script using the prem package updates the open note, and history says it came from outside', async ({
  prem: { page, vault, read }
}) => {
  await openNote(page, 'Samples/S-0001.md')
  await run(
    python,
    ['-c', 'import prem, sys; prem.connect(sys.argv[1]).entry("S-0001").record("Volume left", 40, unit="µL")', vault],
    { env: { ...process.env, PYTHONPATH: path.join(ROOT, 'python', 'src') } }
  )
  await expect.poll(() => read('Samples/S-0001.md')).toContain('| Volume left | 40 | µL |')
  await expect(page.locator('.cm-content')).toContainText('Volume left')

  await page.getByTitle(/^History/).click()
  await expect(page.locator('.history-list li').first()).toContainText('Changed outside Prem')
})
