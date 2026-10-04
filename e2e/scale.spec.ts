import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, launch, ROOT, tempDir, test } from './fixtures'

// How Prem copes with years of notes: a generated vault of 10,000 notes and about 2,000 attachments. It reports
// how long opening and searching take, how much memory Prem uses, and how quickly an edit made in another app
// shows up, and fails if any of them goes past its budget. Run with: npm run e2e:scale
const BUDGET = { openMs: 8_000, searchMs: 1_000, outsideEditMs: 3_000, memoryMb: 900 }

test('a vault of 10,000 notes opens, searches and follows outside edits within budget', { tag: '@slow' }, async () => {
  test.setTimeout(180_000)
  const vault = await tempDir('scale')
  execFileSync('node', [path.join(ROOT, 'scripts/bench-vault.mjs'), vault, '10000', '2000'])

  const started = Date.now()
  const { app, page } = await launch({ vault })
  await expect(page.locator('.file-tree')).toBeVisible({ timeout: 60_000 })
  const openMs = Date.now() - started

  let t = Date.now()
  const hits = await page.evaluate(() => window.api.search('supernatant'))
  const searchMs = Date.now() - t
  expect(hits.ok && hits.value.length).toBeGreaterThan(0)

  // An edit made in another app reaches the index: the new note's link shows up.
  const note = 'Notebook/2030/Written elsewhere.md'
  await mkdir(path.join(vault, 'Notebook/2030'), { recursive: true })
  t = Date.now()
  await writeFile(path.join(vault, note), '# Written elsewhere\n\nSee [[S-0001]].\n')
  await expect
    .poll(
      async () => {
        const links = await page.evaluate((p) => window.api.index.links(p), note)
        return links.ok ? (links.value?.outgoing.length ?? 0) : 0
      },
      { timeout: 30_000, intervals: [100] }
    )
    .toBe(1)
  const outsideEditMs = Date.now() - t

  const memoryMb = Math.round(
    (await app.evaluate(({ app: electronApp }) =>
      electronApp.getAppMetrics().reduce((sum, m) => sum + m.memory.workingSetSize, 0)
    )) / 1024
  )
  await app.close()

  const result = { openMs, searchMs, outsideEditMs, memoryMb }
  console.log(`Large vault: ${JSON.stringify(result)} (budget ${JSON.stringify(BUDGET)})`)
  expect(openMs).toBeLessThan(BUDGET.openMs)
  expect(searchMs).toBeLessThan(BUDGET.searchMs)
  expect(outsideEditMs).toBeLessThan(BUDGET.outsideEditMs)
  expect(memoryMb).toBeLessThan(BUDGET.memoryMb)
})
