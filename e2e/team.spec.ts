import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { promisify } from 'node:util'
import type { Page } from '@playwright/test'
import { expect, launch, openNote, reveal, ROOT, savedStatus, tempDir, test } from './fixtures'

const SERVER = path.join(ROOT, 'out', 'server', 'index.js')
const run = promisify(execFile)

async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = createServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as { port: number }
      probe.close(() => resolve(port))
    })
  })
}

let server: ChildProcess
let url: string
let tokens: Record<string, string>
let config: string

test.beforeAll(async () => {
  const dir = await tempDir('lab')
  config = path.join(dir, 'prem-server.json')
  const port = await freePort()
  const { stdout } = await run('node', [
    SERVER,
    'init',
    '--config',
    config,
    '--pi',
    'pat',
    '--members',
    'alice,bob',
    '--private-notebooks',
    '--port',
    String(port)
  ])
  tokens = Object.fromEntries([...stdout.matchAll(/^ {2}(\S+)\s+(prem_\S+)$/gm)].map((m) => [m[1], m[2]]))
  server = spawn('node', [SERVER, '--config', config], { stdio: 'pipe' })
  url = `http://127.0.0.1:${port}`
  await expect
    .poll(
      () =>
        fetch(`${url}/api/health`).then(
          (r) => r.ok,
          () => false
        ),
      { timeout: 10_000 }
    )
    .toBe(true)
})

test.afterAll(() => {
  server?.kill()
})

async function join(name: string): Promise<{ page: Page; close(): Promise<void> }> {
  const { app, page } = await launch()
  await page.locator('input[autocomplete=url]').fill(url)
  await page.locator('input[type=password]').fill(tokens[name])
  await page.locator('.connect-form button').click()
  await expect(page.locator('.file-tree')).toBeVisible()
  return { page, close: () => app.close() }
}

test('a member writes in their own notebook and cannot see private ones', async () => {
  const alice = await join('alice')
  await reveal(alice.page, 'Notebooks/alice')
  await expect(alice.page.locator('.file-tree [title="Notebooks/bob"]')).toHaveCount(0)
  await expect(alice.page.locator('.file-tree [title="Notebooks/pat"]')).toHaveCount(0)

  await alice.page.keyboard.press('ControlOrMeta+t')
  await expect(alice.page.locator('.breadcrumb')).toHaveAttribute('title', /^Notebooks\/alice\/\d{4}\//)
  await expect(alice.page.locator('.cm-content')).toBeFocused()
  await alice.page.keyboard.type('Transformed DH5α with pUC19-gfp.')
  await savedStatus(alice.page)
  await alice.close()
})

test('a signature and witness appear live in the other person’s window', async () => {
  const alice = await join('alice')
  const pat = await join('pat')
  try {
    await alice.page.keyboard.press('ControlOrMeta+t')
    const entry = (await alice.page.locator('.breadcrumb').getAttribute('title'))!
    await alice.page.locator('.cm-content').click()
    await alice.page.keyboard.press('ControlOrMeta+End')
    await alice.page.keyboard.type('\nColony count: 84.')
    await savedStatus(alice.page)

    // The PI reads every notebook.
    await openNote(pat.page, entry)
    await expect(pat.page.locator('.save-status')).toHaveText('Read only')

    await alice.page.locator('.record-bar').getByRole('button', { name: 'Sign…' }).click()
    await alice.page.getByRole('button', { name: 'Sign and lock' }).click()
    await expect(alice.page.locator('.save-status')).toHaveText('Locked')

    const witness = pat.page.locator('.record-bar').getByRole('button', { name: 'Witness' })
    await expect(witness).toBeVisible()
    await witness.click()
    await expect(alice.page.locator('.record-bar')).toContainText('Witnessed by pat')
  } finally {
    await alice.close()
    await pat.close()
  }
})

test('someone added while the server runs can join without a restart', async () => {
  const { stdout } = await run('node', [SERVER, 'add', 'carol', '--config', config])
  tokens.carol = /(prem_\S+)/.exec(stdout)![1]
  await expect
    .poll(() =>
      fetch(`${url}/api/info`, { headers: { authorization: `Bearer ${tokens.carol}` } }).then((r) => r.status)
    )
    .toBe(200)
  const carol = await join('carol')
  await reveal(carol.page, 'Notebooks/carol')
  await carol.close()
})

test('on a team vault, cells run on your computer against the note’s attachments, after asking about others’ code', async () => {
  const pat = await join('pat')
  const alice = await join('alice')
  try {
    const note = 'Samples/Plate run.md'
    const written = await pat.page.evaluate(async (p) => {
      const csv = new TextEncoder().encode('well,od\nA1,0.41\nA2,0.43\n')
      await window.api.attachments.add(p, 'plate.csv', csv)
      return window.api.vault.write(
        p,
        '# Plate run\n\n```python {run}\nrows = open("attachments/plate.csv").read().splitlines()\nlen(rows) - 1\n```\n',
        { createOnly: true }
      )
    }, note)
    expect(written.ok).toBe(true)

    const questions: string[] = []
    alice.page.on('dialog', (dialog) => {
      questions.push(dialog.message())
      void dialog.accept()
    })
    await reveal(alice.page, note)
    await openNote(alice.page, note)
    await alice.page.locator('.cm-cell-run').dispatchEvent('mousedown')
    await expect(alice.page.locator('.cm-cell-output .cm-cell-text')).toHaveText('2')
    expect(questions).toEqual([expect.stringContaining('pat changed this note last')])
    await savedStatus(alice.page)

    const saved = await pat.page.evaluate((p) => window.api.vault.read(p), note)
    expect(saved.ok && saved.value.content).toMatch(/by=alice .*inputs=Samples\/attachments\/plate\.csv@[0-9a-f]{12}/)
  } finally {
    await pat.close()
    await alice.close()
  }
})
