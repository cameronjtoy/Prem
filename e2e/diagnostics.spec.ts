import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, externalLinks, test } from './fixtures'

test('errors are logged, and Report a problem shows them without private paths, then opens a GitHub issue', async ({
  prem: { app, page, vault, userData }
}) => {
  // Prem logs that it started.
  await expect
    .poll(() => readFile(path.join(userData, 'logs', 'main.log'), 'utf8').catch(() => ''))
    .toMatch(/INFO {2}Prem \S+ started on /)

  // An error in the window, mentioning a file in the vault, reaches the log.
  await page.evaluate((where) => {
    setTimeout(() => {
      throw new Error(`Test failure reading ${where}/Notebook/2026/plate.md`)
    })
  }, vault)
  await expect.poll(() => readFile(path.join(userData, 'logs', 'main.log'), 'utf8')).toContain('Test failure reading')

  await page.keyboard.press('ControlOrMeta+Shift+KeyP')
  await page.locator('.palette input').fill('report a problem')
  await page.keyboard.press('Enter')
  const dialog = page.getByRole('dialog', { name: 'Report a problem' })
  const report = dialog.getByRole('textbox', { name: 'The report' })
  await expect(report).toHaveValue(/- Prem \d+\.\d+\.\d+/)
  await expect(report).toHaveValue(/- Vault: local/)
  await expect(report).toHaveValue(/Test failure reading <vault>\/Notebook\/2026\/plate\.md/)
  expect(await report.inputValue()).not.toContain(vault)

  await dialog.getByRole('button', { name: 'Open GitHub issue' }).click()
  await expect(dialog).toBeHidden()
  const [link] = await externalLinks(app)
  const url = new URL(link)
  expect(url.origin + url.pathname).toBe('https://github.com/cameronjtoy/Prem/issues/new')
  expect(url.searchParams.get('body')).toContain('Test failure reading <vault>/')
  expect(url.searchParams.get('body')).not.toContain(vault)
})
