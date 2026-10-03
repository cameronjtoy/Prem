import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import type { Page } from '@playwright/test'
import { approve, expect, makeWheel, tempDir, test } from './fixtures'

const NOTE = 'Notebook/2026/Ligation of insert into pUC19.md'

type Run = {
  ok: true
  value: { ok: boolean; outputs: unknown[]; inputs: unknown[]; environment: string | null; pythonVersion: string }
}

const run = (page: Page, notePath: string, code: string) =>
  page.evaluate(([p, c]) => window.api.analysis.run(p, c), [notePath, code]) as Promise<
    Run | { ok: false; error: { code: string; message: string } }
  >

/** Approves code to run on this computer, as the dialog does when you choose Run. */
const approveCode = (page: Page, ...code: string[]) =>
  page.evaluate((c) => window.api.analysis.approve({ code: c }), code)

test('cells run in Python on this computer, sharing variables and recording the files they read', async ({
  prem: { page, vault }
}) => {
  await writeFile(path.join(vault, 'Notebook/2026/attachments/plate.csv'), 'well,od\nA1,0.41\n')
  const code = ['x = 40\nprint(x + 2)', 'open("attachments/plate.csv").read().count("\\n") + x']
  // Code nobody approved on this computer is refused by the main process, whatever the window asks.
  expect(await run(page, NOTE, code[0])).toMatchObject({ ok: false, error: { code: 'NEEDS_APPROVAL' } })
  await approveCode(page, ...code)
  const first = await run(page, NOTE, code[0])
  expect(first).toMatchObject({ ok: true, value: { ok: true, outputs: [{ kind: 'text', text: '42\n' }] } })
  expect((first as Run).value.pythonVersion).toMatch(/^3\.\d+/)
  expect((first as Run).value.environment).toBeNull()

  const second = await run(page, NOTE, code[1])
  expect(second).toMatchObject({
    ok: true,
    value: {
      outputs: [{ kind: 'result', text: '42' }],
      inputs: [{ path: 'Notebook/2026/attachments/plate.csv', sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }]
    }
  })
})

test('signed notes and the setting that turns Python off both stop cells running', async ({
  prem: { page, userData }
}) => {
  const signed = await page.evaluate((p) => window.api.record.sign(p), NOTE)
  expect(signed.ok).toBe(true)
  expect(await run(page, NOTE, '1')).toMatchObject({ ok: false, error: { code: 'LOCKED' } })

  await writeFile(path.join(userData, 'settings.json'), JSON.stringify({ 'analysis.enabled': false }))
  await expect.poll(async () => (await run(page, 'Welcome.md', '1')).ok).toBe(false)
  expect(await run(page, 'Welcome.md', '1')).toMatchObject({ error: { message: /turned off in Settings/ } })
})

test('Settings shows the Python found and sets up the vault environment from environment.txt', async ({
  prem: { page, vault }
}) => {
  const wheel = makeWheel(await tempDir('wheel'))
  await writeFile(path.join(vault, 'environment.txt'), `${wheel}\n`)

  await page.keyboard.press('ControlOrMeta+Comma')
  const status = page.locator('[data-setting="analysis.status"]')
  await expect(status).toContainText(/Python 3\.\d+/)
  await expect(status).toContainText("hasn't been set up on this computer yet")
  await status.getByRole('button', { name: 'Set up environment' }).click()
  await approve(page)
  await expect(status).toContainText("This vault's environment is ready", { timeout: 120_000 })
  const id = (await status.locator('.env-state').textContent())!.match(/environment ([0-9a-f]{12})/)![1]

  await approveCode(page, 'import premtiny\npremtiny.VALUE')
  const result = await run(page, 'Welcome.md', 'import premtiny\npremtiny.VALUE')
  expect(result).toMatchObject({ ok: true, value: { outputs: [{ kind: 'result', text: '42' }], environment: id } })
})
