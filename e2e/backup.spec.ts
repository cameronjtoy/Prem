import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { answerSaveDialog, expect, openNote, savedStatus, tempDir, test } from './fixtures'

test('Back up vault zips every note, attachment and the history', async ({ prem: { app, page } }) => {
  // Make some history: an edit to a note.
  await openNote(page, 'Welcome.md')
  await page.locator('.cm-content').focus()
  await page.keyboard.press('ControlOrMeta+End')
  await page.keyboard.type('\nBacked up today.')
  await savedStatus(page)

  const file = path.join(await tempDir('backup'), 'Lab backup.zip')
  await answerSaveDialog(app, file)
  await page.keyboard.press('ControlOrMeta+Shift+KeyP')
  await page.locator('.palette input').fill('back up vault')
  await page.keyboard.press('Enter')
  await expect(page.locator('.banner.info')).toContainText(/Backed up \d+ files \(.+\) to .*Lab backup\.zip/)

  const names = JSON.parse(
    execFileSync('python3', [
      '-c',
      'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps(z.namelist()))',
      file
    ]).toString()
  ) as string[]
  expect(names).toContain('Welcome.md')
  expect(names).toContain('.prem/format.json')
  expect(names).toContain('.prem/history/Welcome.md.jsonl')
  expect(names.some((n) => n.startsWith('.prem/objects/'))).toBe(true)
  expect(names.some((n) => /attachments\/.+\.png$/.test(n))).toBe(true)
})
