import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../notes/frontmatter'
import {
  completeStage,
  createJob,
  isJob,
  isWorkflow,
  jobPath,
  jobState,
  linkTarget,
  logRunStarted,
  parseStages,
  tagRun
} from './workflows'

const workflow = `---
type: workflow
version: 2
---

# Plasmid prep

## Stages
| Stage | Protocol | Assignee | Outputs |
| --- | --- | --- | --- |
| Grow culture | [[Overnight culture]] | bob | Culture tube |
| Miniprep | [[Protocols/Plasmid miniprep|Miniprep]] | alice | Plasmid sample |
| Sequence check |  | alice | Sequencing result |
|  | ignored row without a name | | |

## Notes
Anything else.
`

const now = new Date(2026, 9, 3, 9, 30)
const later = new Date(2026, 9, 3, 17, 2)
const fields = (text: string): Record<string, string> => parseFrontmatter(text).fields

describe('workflows', () => {
  it('recognises workflows and jobs', () => {
    expect(isWorkflow(workflow)).toBe(true)
    expect(isJob(workflow)).toBe(false)
    expect(isJob(createJob('Workflows/Plasmid prep.md', workflow, { now, author: 'cam' }))).toBe(true)
  })

  it('reads stages, with link targets and manual stages', () => {
    expect(parseStages(workflow)).toEqual([
      { name: 'Grow culture', protocol: 'Overnight culture', assignee: 'bob', outputs: 'Culture tube' },
      { name: 'Miniprep', protocol: 'Protocols/Plasmid miniprep', assignee: 'alice', outputs: 'Plasmid sample' },
      { name: 'Sequence check', protocol: null, assignee: 'alice', outputs: 'Sequencing result' }
    ])
  })

  it('has no stages without a Stages table', () => {
    expect(parseStages('# Empty\n')).toEqual([])
    expect(() => createJob('W.md', '# Empty\n', { now, author: 'cam' })).toThrow(/no stages/)
  })

  it('files jobs by workflow and time', () => {
    expect(jobPath('Workflows/Plasmid prep.md', now)).toBe('Jobs/Plasmid prep/Plasmid prep job 2026-10-03 0930.md')
  })

  it('linkTarget takes the first link', () => {
    expect(linkTarget('"[[Job 1#Log|the job]]"')).toBe('Job 1')
    expect(linkTarget('no link')).toBeNull()
    expect(linkTarget(undefined)).toBeNull()
  })
})

describe('a job', () => {
  const job = createJob('Workflows/Plasmid prep.md', workflow, { now, author: 'cam' })

  it('starts at the first stage with its assignee', () => {
    expect(fields(job)).toMatchObject({
      type: 'job',
      workflow: '[[Plasmid prep]]',
      'workflow-version': '2',
      stage: 'Grow culture',
      assignee: 'bob',
      status: 'open',
      created: '2026-10-03 09:30'
    })
    const state = jobState(job)
    expect(state.index).toBe(0)
    expect(state.stages).toHaveLength(3)
    expect(state.log).toEqual([])
    expect(state.openRow).toBeNull()
  })

  it('keeps its own copy of the stages', () => {
    // The workflow changing later doesn't change jobs already under way.
    expect(parseStages(job).map((s) => s.name)).toEqual(['Grow culture', 'Miniprep', 'Sequence check'])
    expect(job).toContain('| Miniprep | [[Protocols/Plasmid miniprep|Miniprep]] | alice | Plasmid sample |')
  })

  it('goes through runs and a manual stage to done', () => {
    let text = logRunStarted(job, { stage: 'Grow culture', run: 'Overnight culture run 1', by: 'bob', now })
    let state = jobState(text)
    expect(state.status).toBe('in progress')
    expect(state.openRow).toEqual({
      stage: 'Grow culture',
      run: 'Overnight culture run 1',
      by: 'bob',
      started: '2026-10-03 09:30',
      completed: ''
    })
    expect(text).toContain('| Grow culture | [[Overnight culture run 1]] | bob | 2026-10-03 09:30 |   |')

    text = completeStage(text, { by: 'bob', now: later })
    state = jobState(text)
    expect(fields(text)).toMatchObject({ stage: 'Miniprep', assignee: 'alice', status: 'in progress' })
    expect(state.log[0].completed).toBe('2026-10-03 17:02')
    expect(state.openRow).toBeNull()

    text = logRunStarted(text, { stage: 'Miniprep', run: 'Plasmid miniprep run 1', by: 'alice', now: later })
    text = completeStage(text, { by: 'alice', now: later })
    expect(fields(text).stage).toBe('Sequence check')

    // A stage without a protocol is logged without a run when it's completed.
    text = completeStage(text, { by: 'alice', now: later })
    state = jobState(text)
    expect(fields(text)).toMatchObject({ status: 'done', finished: '2026-10-03 17:02' })
    expect(state.index).toBe(-1)
    expect(state.current).toBeNull()
    expect(state.log.map((r) => [r.stage, r.run, r.completed])).toEqual([
      ['Grow culture', 'Overnight culture run 1', '2026-10-03 17:02'],
      ['Miniprep', 'Plasmid miniprep run 1', '2026-10-03 17:02'],
      ['Sequence check', null, '2026-10-03 17:02']
    ])
    // The rest of the note is untouched.
    expect(text).toContain('## Samples\n- [[ ]]\n')
    expect(text.endsWith('## Notes\n')).toBe(true)

    // Completing a finished job changes nothing.
    expect(completeStage(text, { by: 'alice', now: later })).toBe(text)
  })

  it('adds a Stage log section if someone removed it', () => {
    const stripped = job.replace(/## Stage log\n[\s\S]*?(?=## Notes)/, '')
    const text = logRunStarted(stripped, { stage: 'Grow culture', run: 'R', by: 'bob', now })
    expect(jobState(text).log).toHaveLength(1)
  })
})

it('tagRun links a run to its job and stage', () => {
  const run = '---\ntype: run\nstatus: in progress\n---\n\n# Run\n'
  expect(fields(tagRun(run, 'Plasmid prep job 1', 'Miniprep'))).toMatchObject({
    type: 'run',
    job: '[[Plasmid prep job 1]]',
    stage: 'Miniprep'
  })
})
