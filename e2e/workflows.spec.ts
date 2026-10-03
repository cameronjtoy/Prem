import type { Dialog } from '@playwright/test'
import { expect, openNote, savedStatus, test } from './fixtures'

const WORKFLOW = 'Workflows/Plasmid prep.md'

const field = (text: string, key: string): string | undefined =>
  new RegExp(`^${key}: (.*)$`, 'm').exec(text)?.[1]?.trim()

test('takes a job through a workflow: runs, hand-offs, done and signed', async ({ prem: { page, read } }) => {
  await openNote(page, WORKFLOW)
  const bar = page.locator('.run-bar')
  await expect(bar).toContainText('Workflow · version 1')
  await expect(bar).toContainText('3 stages')
  await bar.getByRole('button', { name: /New job/ }).click()

  await expect(bar).toContainText('New job')
  await expect(bar).toContainText('stage 1 of 3: Grow culture · bob')
  const jobPath = (await page.locator('.breadcrumb').getAttribute('title'))!
  expect(jobPath).toMatch(/^Jobs\/Plasmid prep\/Plasmid prep job \d{4}-\d\d-\d\d \d{4}\.md$/)
  const job = await read(jobPath)
  expect(field(job, 'stage')).toBe('Grow culture')
  expect(field(job, 'assignee')).toBe('bob')
  expect(field(job, 'status')).toBe('open')
  const jobTitle = jobPath.split('/').pop()!.replace(/\.md$/, '')

  // Start run: the run is linked to the job, and the job logs it.
  await bar.getByRole('button', { name: /Start run/ }).click()
  await expect(bar).toContainText('Run in progress')
  await expect(bar.getByTitle(`Part of ${jobTitle}, stage Grow culture`)).toBeVisible()
  const runPath = (await page.locator('.breadcrumb').getAttribute('title'))!
  expect(runPath).toMatch(/^Notebook\/Runs\/\d{4}\/Overnight culture run /)
  const run = await read(runPath)
  expect(field(run, 'job')).toBe(`"[[${jobTitle}]]"`)
  expect(field(run, 'stage')).toBe('Grow culture')
  const runTitle = runPath.split('/').pop()!.replace(/\.md$/, '')
  await expect.poll(() => read(jobPath)).toContain(`| Grow culture | [[${runTitle}]] |`)
  expect(field(await read(jobPath), 'status')).toBe('in progress')

  // Finish the run, then go back to the job through the run bar's link.
  page.once('dialog', (dialog) => void dialog.accept())
  await bar.getByRole('button', { name: 'Complete run' }).click()
  await expect(bar).toContainText('Completed run')
  await savedStatus(page)
  await bar.getByTitle(/^Part of /).click()
  await expect(bar).toContainText('Job in progress')
  await expect(bar.getByRole('button', { name: 'Open run' })).toBeVisible()
  await expect(bar.getByRole('button', { name: /Start run/ })).toHaveCount(0)

  // The run is complete, so the stage completes without asking.
  let asked = false
  const onDialog = (dialog: Dialog): void => {
    asked = true
    void dialog.dismiss()
  }
  page.on('dialog', onDialog)
  await bar.getByRole('button', { name: 'Complete stage' }).click()
  await expect(bar).toContainText('stage 2 of 3: Miniprep · alice')
  page.off('dialog', onDialog)
  expect(asked).toBe(false)
  await savedStatus(page)
  let text = await read(jobPath)
  expect(field(text, 'stage')).toBe('Miniprep')
  expect(field(text, 'assignee')).toBe('alice')
  expect(text).toMatch(
    new RegExp(`\\| Grow culture \\| \\[\\[${runTitle}\\]\\] \\| .* \\| \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d \\|\\n`)
  )

  // A stage whose run isn't finished asks first; dismissing leaves the job where it was.
  await bar.getByRole('button', { name: /Start run/ }).click()
  await expect(bar).toContainText('Run in progress')
  await bar.getByTitle(/^Part of /).click()
  await expect(bar).toContainText('stage 2 of 3: Miniprep')
  const question = new Promise<string>((resolve) =>
    page.once('dialog', (dialog) => {
      resolve(dialog.message())
      void dialog.dismiss()
    })
  )
  await bar.getByRole('button', { name: 'Complete stage' }).click()
  expect(await question).toBe("The Miniprep run isn't complete. Complete the stage anyway?")
  await expect(bar).toContainText('stage 2 of 3: Miniprep')
  page.once('dialog', (dialog) => void dialog.accept())
  await bar.getByRole('button', { name: 'Complete stage' }).click()
  await expect(bar).toContainText('stage 3 of 3: Sequence check')

  // The last stage has no protocol: no run to start, and completing it finishes the job.
  await expect(bar.getByRole('button', { name: /Start run/ })).toHaveCount(0)
  await bar.getByRole('button', { name: 'Complete job' }).click()
  await expect(bar).toContainText('Job done')
  await savedStatus(page)
  text = await read(jobPath)
  expect(field(text, 'status')).toBe('done')
  expect(field(text, 'finished')).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d$/)
  expect(text).toMatch(/\| Sequence check \| {3}\| .*\|\n/)

  // Signing locks the job, stage log and all.
  await page.locator('.record-bar').getByRole('button', { name: 'Sign…' }).click()
  await page.locator('.record-form input').fill('Plasmid verified')
  await page.getByRole('button', { name: 'Sign and lock' }).click()
  await expect(page.locator('.save-status')).toHaveText('Locked')
  await expect(bar.getByRole('button')).toHaveCount(1) // only the link to the workflow
})

test('the sample job shows its progress and links to its runs', async ({ prem: { page } }) => {
  await openNote(page, 'Jobs/Plasmid prep/Plasmid prep job 2026-09-28 0900.md')
  const bar = page.locator('.run-bar')
  await expect(bar).toContainText('stage 3 of 3: Sequence check · alice')
  await expect(bar.locator('.run-progress-label')).toHaveText('2/3 stages')

  await openNote(page, 'Notebook/Runs/2026/Plasmid miniprep run 2026-09-29 1410.md')
  await bar.getByTitle('Part of Plasmid prep job 2026-09-28 0900, stage Miniprep').click()
  await expect(page.locator('.breadcrumb')).toHaveAttribute(
    'title',
    'Jobs/Plasmid prep/Plasmid prep job 2026-09-28 0900.md'
  )
})
