import { describe, expect, it } from 'vitest'
import { LinkIndex } from './linkIndex'
import { createResolver } from './resolve'

describe('createResolver', () => {
  const resolve = createResolver(['Home.md', 'Ops/Deploy.md', 'Finance/Deploy.md', 'Ops/Runbooks/Restart.md'])

  it('matches names case-insensitively, with or without .md', () => {
    expect(resolve('home')).toBe('Home.md')
    expect(resolve('Restart.md')).toBe('Ops/Runbooks/Restart.md')
  })

  it('prefers a note in the same folder when names collide', () => {
    expect(resolve('Deploy', 'Finance/Budget.md')).toBe('Finance/Deploy.md')
    expect(resolve('Deploy', 'Ops/Notes.md')).toBe('Ops/Deploy.md')
  })

  it('falls back to the shortest path, then alphabetical', () => {
    expect(resolve('Deploy', 'Home.md')).toBe('Ops/Deploy.md')
  })

  it('matches paths by suffix', () => {
    expect(resolve('Runbooks/Restart')).toBe('Ops/Runbooks/Restart.md')
    expect(resolve('Finance/Deploy')).toBe('Finance/Deploy.md')
  })

  it('returns null for missing notes', () => {
    expect(resolve('Nope')).toBeNull()
    expect(resolve('  ')).toBeNull()
  })
})

function build(): LinkIndex {
  const index = new LinkIndex()
  index.build([
    { path: 'A.md', content: 'Links to [[B]] and [[Missing]].\nAgain [[B|bee]]' },
    { path: 'B.md', content: 'Back to [[A]]' },
    { path: 'C.md', content: 'Self [[C]] and [[B]]' },
    { path: 'templates/Runbook.md', content: '[[A]]' }
  ])
  return index
}

describe('LinkIndex', () => {
  it('computes backlinks with snippets', () => {
    const snap = build().snapshot()
    expect(snap.backlinks['B.md']).toEqual([
      { source: 'A.md', snippets: ['Links to [[B]] and [[Missing]].', 'Again [[B|bee]]'] },
      { source: 'C.md', snippets: ['Self [[C]] and [[B]]'] }
    ])
    expect(snap.backlinks['A.md'].map((b) => b.source)).toEqual(['B.md'])
    expect(snap.backlinks['C.md']).toBeUndefined()
  })

  it('builds a graph with unresolved nodes, deduplicated edges and no templates', () => {
    const { nodes, links } = build().snapshot().graph
    expect(nodes.map((n) => n.id).sort()).toEqual(['A.md', 'B.md', 'C.md', 'unresolved:missing'])
    expect(links).toContainEqual({ source: 'A.md', target: 'B.md' })
    expect(links.filter((l) => l.source === 'A.md' && l.target === 'B.md')).toHaveLength(1)
    expect(links.some((l) => l.source === l.target)).toBe(false)
    expect(nodes.find((n) => n.id === 'unresolved:missing')?.resolved).toBe(false)
  })

  it('resolves dangling links once the note is created, and un-resolves on delete', () => {
    const index = build()
    expect(index.snapshot().outgoing['A.md'].find((l) => l.target === 'Missing')?.resolved).toBeNull()
    index.upsert('Missing.md', '')
    expect(index.snapshot().backlinks['Missing.md']?.[0].source).toBe('A.md')
    index.remove('Missing.md')
    expect(index.snapshot().backlinks['Missing.md']).toBeUndefined()
  })

  it('updates when a note is edited or a folder is removed', () => {
    const index = build()
    index.upsert('C.md', 'no links now')
    expect(index.snapshot().backlinks['B.md'].map((b) => b.source)).toEqual(['A.md'])
    index.upsert('Sub/D.md', '[[A]]')
    index.removeFolder('Sub')
    expect(index.has('Sub/D.md')).toBe(false)
  })
})

const workflowNote =
  '---\ntype: workflow\n---\n# W\n\n## Stages\n| Stage | Protocol | Assignee | Outputs |\n| --- | --- | --- | --- |\n| Prep | | bob | |\n| Check | | alice | |\n'
const jobNote = (stage: string, assignee: string) =>
  `---\ntype: job\nworkflow: "[[W]]"\nstage: ${stage}\nassignee: ${assignee}\nstatus: open\ncreated: 2026-10-03 09:30\n---\n# W job\n\n## Stages\n| Stage | Protocol | Assignee | Outputs |\n| --- | --- | --- | --- |\n| Prep | | bob | |\n| Check | | alice | |\n`

describe('LinkIndex jobs and workflows', () => {
  it('lists workflows and jobs, leaving out templates, and keeps them up to date', () => {
    const index = new LinkIndex()
    index.build([
      { path: 'Workflows/W.md', content: workflowNote },
      { path: 'Jobs/W/W job 1.md', content: jobNote('Prep', 'bob') },
      { path: 'templates/Job.md', content: jobNote('Prep', 'bob') },
      { path: 'Notes/plain.md', content: '# Plain' }
    ])
    let snap = index.snapshot()
    expect(snap.workflows).toEqual([{ path: 'Workflows/W.md', title: 'W', stages: ['Prep', 'Check'] }])
    expect(snap.jobs.map((j) => [j.path, j.stage, j.assignee])).toEqual([['Jobs/W/W job 1.md', 'Prep', 'bob']])

    index.upsert('Jobs/W/W job 1.md', jobNote('Check', 'alice'))
    snap = index.snapshot()
    expect(snap.jobs.map((j) => [j.stage, j.assignee])).toEqual([['Check', 'alice']])

    index.upsert('Jobs/W/W job 1.md', '# No longer a job')
    expect(index.snapshot().jobs).toEqual([])
  })
})

describe('LinkIndex slices for the window', () => {
  it('serves a small summary, one note’s links, and works out the full index once per change', () => {
    const index = new LinkIndex()
    index.build([
      { path: 'A.md', content: 'See [[B]] and [[Nowhere]].' },
      { path: 'B.md', content: 'Back to [[A]].' }
    ])
    const summary = index.summary()
    expect(Object.keys(summary).sort()).toEqual(['jobs', 'version', 'workflows'])
    expect(index.linksFor('A.md')).toEqual({
      backlinks: [{ source: 'B.md', snippets: ['Back to [[A]].'] }],
      outgoing: [
        { target: 'B', resolved: 'B.md' },
        { target: 'Nowhere', resolved: null }
      ]
    })
    expect(index.linksFor('Missing.md')).toEqual({ backlinks: [], outgoing: [] })
    expect(index.snapshot()).toBe(index.snapshot())
    const before = index.snapshot()
    index.upsert('C.md', 'New, linking [[A]].')
    expect(index.snapshot()).not.toBe(before)
    expect(index.linksFor('A.md').backlinks.map((b) => b.source)).toEqual(['B.md', 'C.md'])
    expect(index.summary().version).toBeGreaterThan(summary.version)
  })
})
