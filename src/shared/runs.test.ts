import { describe, expect, it } from 'vitest'
import { parseFrontmatter, setFrontmatterField } from './frontmatter'
import { addDeviation, completeRun, createRun, isProtocol, isRun, runPath, runProgress, toggleRunTask } from './runs'

const protocol = `---
type: protocol
version: 3
---

# Miniprep

## Purpose
Isolate plasmid DNA.

## Materials
| Reagent | Amount |
| --- | --- |
| P1 buffer | 250 µL |

## Steps
1. [x] Pellet 2 mL culture ✓ 09:12
2. [ ] Resuspend in P1
   - [ ] Vortex until no clumps

## Troubleshooting
Low yield: use fresh culture.
`

const now = new Date(2026, 8, 30, 14, 5)

describe('frontmatter', () => {
  it('reads flat fields and strips quotes', () => {
    const { fields, end } = parseFrontmatter('---\ntype: run\nprotocol: "[[Miniprep]]"\n---\n# X')
    expect(fields).toEqual({ type: 'run', protocol: '[[Miniprep]]' })
    expect('---\ntype: run\nprotocol: "[[Miniprep]]"\n---\n# X'.slice(end)).toBe('# X')
    expect(parseFrontmatter('# no frontmatter').end).toBe(0)
  })

  it('updates or adds one field and leaves the rest alone', () => {
    const text = '---\na: 1\nb: 2\n---\nbody'
    expect(setFrontmatterField(text, 'b', 'x')).toBe('---\na: 1\nb: x\n---\nbody')
    expect(setFrontmatterField(text, 'c', '3')).toBe('---\na: 1\nb: 2\nc: 3\n---\nbody')
    expect(setFrontmatterField('body', 'c', '3')).toBe('---\nc: 3\n---\n\nbody')
  })
})

describe('protocol runs', () => {
  it('files runs in the notebook by year', () => {
    expect(runPath('Notebooks/alice', 'Protocols/Miniprep.md', now)).toBe(
      'Notebooks/alice/Runs/2026/Miniprep run 2026-09-30 1405.md'
    )
  })

  it('snapshots materials and steps with fresh checkboxes', () => {
    const run = createRun('Protocols/Miniprep.md', protocol, { now, operator: 'alice' })
    expect(isRun(run)).toBe(true)
    expect(isProtocol(protocol)).toBe(true)
    const { fields } = parseFrontmatter(run)
    expect(fields).toMatchObject({
      protocol: '[[Miniprep]]',
      'protocol-version': '3',
      operator: 'alice',
      started: '2026-09-30 14:05',
      status: 'in progress'
    })
    expect(run).toContain('| P1 buffer | 250 µL |')
    expect(run).toContain('1. [ ] Pellet 2 mL culture\n')
    expect(run).toContain('   - [ ] Vortex until no clumps')
    expect(run).not.toContain('Troubleshooting')
    expect(run).not.toContain('Purpose')
    expect(runProgress(run)).toEqual({ done: 0, total: 3 })
  })

  it('uses the whole protocol as steps when it has no Steps section', () => {
    const run = createRun('P.md', '# P\n- [x] only step', { now, operator: '' })
    expect(run).toContain('## Steps\n# P\n- [ ] only step')
  })

  it('stamps a step with the time when ticked and clears it when unticked', () => {
    const ticked = toggleRunTask('2. [ ] Resuspend in P1', true, now, '2026-09-30')
    expect(ticked).toBe('2. [x] Resuspend in P1 ✓ 14:05')
    expect(toggleRunTask(ticked, false, now, '2026-09-30')).toBe('2. [ ] Resuspend in P1')
    expect(toggleRunTask('- [ ] Next day', true, now, '2026-09-29')).toBe('- [x] Next day ✓ 2026-09-30 14:05')
    expect(toggleRunTask('not a task', true, now, '2026-09-30')).toBe('not a task')
  })

  it('marks a run complete with its finish time', () => {
    const run = completeRun(createRun('P.md', protocol, { now, operator: 'a' }), new Date(2026, 8, 30, 15, 20))
    expect(parseFrontmatter(run).fields).toMatchObject({ status: 'complete', finished: '2026-09-30 15:20' })
  })

  it('adds timestamped deviations under their heading', () => {
    const run = createRun('P.md', protocol, { now, operator: 'a' })
    const first = addDeviation(run, now)
    expect(first.text).toContain('## Deviations\n- 14:05 — \n\n## Results')
    expect(first.text).not.toContain('- None')
    expect(first.text.slice(0, first.cursor).endsWith('- 14:05 — ')).toBe(true)
    const typed = first.text.slice(0, first.cursor) + 'spun 5 min longer' + first.text.slice(first.cursor)
    const second = addDeviation(typed, new Date(2026, 8, 30, 14, 30))
    expect(second.text).toContain('- 14:05 — spun 5 min longer\n- 14:30 — \n\n## Results')
  })

  it('adds a Deviations section when a run has none', () => {
    const { text, cursor } = addDeviation('---\ntype: run\n---\n# R\n', now)
    expect(text).toBe('---\ntype: run\n---\n# R\n\n## Deviations\n- 14:05 — \n')
    expect(text.slice(0, cursor).endsWith('— ')).toBe(true)
  })
})
