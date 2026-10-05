import { describe, expect, it } from 'vitest'
import { parseFrontmatter } from '../notes/frontmatter'
import { LinkIndex } from '../notes/linkIndex'
import type { BoxSummary, SampleSummary } from '../vault/types'
import {
  createSample,
  formatLocation,
  freezers,
  locationLog,
  moveSample,
  nextSampleId,
  parseLocation,
  parseWell,
  placeRefusal,
  setSampleStatus,
  storageBoxes,
  summarizeBox,
  summarizeSample,
  wellName
} from './samples'

const now = new Date(2026, 9, 4, 14, 5)

const sample = (id: string, location: string, extra = ''): string =>
  `---\ntype: sample\nid: ${id}\nsample-type: plasmid DNA\nlocation: ${location}\ncreated: 2026-10-01\ncreated-by: alice\n${extra}---\n\n# ${id}\n\n## Notes\n`

const box = (fields: string): BoxSummary => summarizeBox('Freezers/Box 3.md', `---\ntype: box\n${fields}---\n`)

const summary = (id: string, location: string, extra = ''): SampleSummary =>
  summarizeSample(`Samples/${id}.md`, sample(id, location, extra))

describe('wells', () => {
  it('names wells by row letter and column number', () => {
    expect(wellName({ row: 0, column: 0 })).toBe('A1')
    expect(wellName({ row: 7, column: 11 })).toBe('H12')
    expect(wellName({ row: 26, column: 0 })).toBe('AA1')
    expect(parseWell('h12')).toEqual({ row: 7, column: 11 })
    expect(parseWell('B07')).toEqual({ row: 1, column: 6 })
    expect(parseWell('AA1')).toEqual({ row: 26, column: 0 })
    expect(parseWell('box 3')).toBeNull()
    expect(parseWell('A0')).toBeNull()
  })
})

describe('locations', () => {
  it('reads the container, the well and a note in brackets', () => {
    expect(parseLocation('Freezer A, box 1, C4 (glycerol stock)')).toEqual({
      container: ['Freezer A', 'box 1'],
      well: { row: 2, column: 3 },
      note: 'glycerol stock'
    })
    expect(parseLocation('Freezer A / Rack 2 / Box 5 / B7').container).toEqual(['Freezer A', 'Rack 2', 'Box 5'])
    expect(parseLocation('Fridge, door shelf')).toEqual({ container: ['Fridge', 'door shelf'], well: null, note: '' })
    expect(parseLocation('')).toEqual({ container: [], well: null, note: '' })
  })

  it('writes them back the same way', () => {
    expect(formatLocation(['Freezer B', 'box 3'], { row: 0, column: 1 })).toBe('Freezer B, box 3, A2')
    expect(formatLocation(['Freezer A', 'box 1'], { row: 2, column: 3 }, 'glycerol stock')).toBe(
      'Freezer A, box 1, C4 (glycerol stock)'
    )
  })
})

describe('summaries', () => {
  it('summarizes a sample from its frontmatter', () => {
    expect(summary('S-0001', 'Freezer B, box 3, A1')).toEqual({
      path: 'Samples/S-0001.md',
      title: 'S-0001',
      id: 'S-0001',
      kind: 'plasmid DNA',
      location: 'Freezer B, box 3, A1',
      box: 'Freezer B, box 3',
      well: 'A1',
      status: 'available',
      created: '2026-10-01',
      createdBy: 'alice'
    })
    expect(summary('S-9', '', 'status: used up\n')).toMatchObject({ box: null, well: null, status: 'used up' })
    expect(summary('S-9', 'x', 'status: lost\n').status).toBe('available')
  })

  it('summarizes a box, with a default size', () => {
    expect(box('location: Freezer B, box 3\nrows: 8\ncolumns: 12\n')).toEqual({
      path: 'Freezers/Box 3.md',
      location: 'Freezer B, box 3',
      rows: 8,
      columns: 12
    })
    expect(box('location: Freezer B, box 3\nrows: 0\n')).toMatchObject({ rows: 9, columns: 9 })
  })

  it('are kept by the link index and asked for on their own', () => {
    const index = new LinkIndex()
    index.build([
      { path: 'Samples/S-0002.md', content: sample('S-0002', 'Freezer A, box 1, C4') },
      { path: 'Samples/S-0010.md', content: sample('S-0010', 'Freezer A, box 1, C5') },
      { path: 'Freezers/A1.md', content: '---\ntype: box\nlocation: Freezer A, box 1\nrows: 10\ncolumns: 10\n---\n' },
      { path: 'templates/Sample.md', content: sample('{{title}}', '') },
      { path: 'Notes/plain.md', content: '# Plain' }
    ])
    const { samples, boxes } = index.samples()
    expect(samples.map((s) => s.id)).toEqual(['S-0002', 'S-0010'])
    expect(boxes).toEqual([{ path: 'Freezers/A1.md', location: 'Freezer A, box 1', rows: 10, columns: 10 }])
    expect(index.samples()).toEqual({ samples, boxes })

    index.upsert('Samples/S-0002.md', sample('S-0002', 'Freezer A, box 1, D1'))
    expect(index.samples().samples[0].well).toBe('D1')
    expect(index.summary()).not.toHaveProperty('samples')
  })
})

describe('the freezer map', () => {
  const samples = [
    summary('S-1', 'Freezer B, box 3, A1'),
    summary('S-2', 'Freezer B, box 3, A2'),
    summary('S-3', 'Freezer A, box 1, C4 (glycerol stock)'),
    summary('S-4', 'freezer b, Box 3, A2'),
    summary('S-5', 'Freezer B, box 3'),
    summary('S-6', 'Freezer B, box 3, A3', 'status: used up\n'),
    summary('S-7', 'Freezer A, box 2, J12')
  ]
  const boxes = storageBoxes([{ path: 'Freezers/B3.md', location: 'Freezer B, box 3', rows: 8, columns: 12 }], samples)

  it('puts each sample in its box and well, matching names whatever their case', () => {
    expect(boxes.map((b) => b.location)).toEqual(['Freezer A, box 1', 'Freezer A, box 2', 'Freezer B, box 3'])
    const b3 = boxes[2]
    expect(b3).toMatchObject({ path: 'Freezers/B3.md', rows: 8, columns: 12 })
    expect(b3.wells.get('A1')!.map((s) => s.id)).toEqual(['S-1'])
    expect(b3.wells.get('A2')!.map((s) => s.id)).toEqual(['S-2', 'S-4'])
    expect(b3.unplaced.map((s) => s.id)).toEqual(['S-5'])
    expect(b3.wells.has('A3')).toBe(false)
  })

  it('grows a box without a note to fit what is in it', () => {
    expect(boxes[0]).toMatchObject({ path: null, rows: 9, columns: 9 })
    expect(boxes[1]).toMatchObject({ rows: 10, columns: 12 })
    expect(boxes[1].wells.get('J12')!.map((s) => s.id)).toEqual(['S-7'])
  })

  it('lists the freezers', () => {
    expect(freezers(boxes)).toEqual(['Freezer A', 'Freezer B'])
  })

  it('refuses a place that is taken or outside the box', () => {
    expect(placeRefusal(boxes, 'Freezer B, box 3, A1', 'Samples/S-2.md')).toBe(
      'A1 in Freezer B, box 3 already holds S-1.'
    )
    expect(placeRefusal(boxes, 'Freezer B, box 3, A1', 'Samples/S-1.md')).toBeNull()
    expect(placeRefusal(boxes, 'Freezer B, box 3, A3', null)).toBeNull()
    expect(placeRefusal(boxes, 'Freezer B, box 3, J1', null)).toMatch(/8 rows and 12 columns, so there's no J1/)
    expect(placeRefusal(boxes, 'Freezer C, box 9, A1', null)).toBeNull()
    expect(placeRefusal(boxes, '', null)).toMatch(/Say where/)
  })
})

describe('sample IDs', () => {
  it('counts up from the highest ID with the same fixed parts', () => {
    expect(nextSampleId('S-{####}', ['S-0001', 'S-0003', 'X-0009', 's-0002'], now)).toBe('S-0004')
    expect(nextSampleId('S-{####}', [], now)).toBe('S-0001')
    expect(nextSampleId('S-{YYYY}-{###}', ['S-2026-007', 'S-2025-120'], now)).toBe('S-2026-008')
    expect(nextSampleId('{YY}{MM}-{##}', ['2610-09'], now)).toBe('2610-10')
    expect(nextSampleId('S-{##}', ['S-99'], now)).toBe('S-100')
  })
})

describe('creating, moving and using up a sample', () => {
  const template =
    '---\ntype: sample\nid: {{title}}\nsample-type:\nlocation:\ncreated: {{date}}\ncreated-by: {{author}}\n---\n\n# {{title}}\n\n## Notes\n{{cursor}}\n'

  it('fills in the template', () => {
    const text = createSample(template, { id: 'S-0004', location: 'Freezer B, box 3, B1', author: 'bob', now })
    expect(parseFrontmatter(text).fields).toMatchObject({
      type: 'sample',
      id: 'S-0004',
      location: 'Freezer B, box 3, B1',
      created: '2026-10-04',
      'created-by': 'bob'
    })
    expect(text).toContain('# S-0004')
    expect(text).not.toContain('{{')
  })

  it('makes a sample note even from a template that is not one', () => {
    const text = createSample('# {{title}}\n', { id: 'S-1', location: '', author: 'bob', now })
    expect(parseFrontmatter(text).fields).toMatchObject({ type: 'sample', id: 'S-1' })
  })

  it('logs each move and keeps the history in the note', () => {
    let text = sample('S-0001', 'Freezer B, box 3, A1')
    text = moveSample(text, 'Freezer A, box 1, B2', { by: 'alice', now })
    text = moveSample(text, 'Freezer A, box 1, B3', { by: 'bob', now: new Date(2026, 9, 5, 9, 0) })
    expect(parseFrontmatter(text).fields.location).toBe('Freezer A, box 1, B3')
    expect(locationLog(text)).toEqual([
      { when: '2026-10-04 14:05', from: 'Freezer B, box 3, A1', to: 'Freezer A, box 1, B2', by: 'alice' },
      { when: '2026-10-05 09:00', from: 'Freezer A, box 1, B2', to: 'Freezer A, box 1, B3', by: 'bob' }
    ])
    expect(text).toMatch(/## Notes\n\n## Location log\n\| When \| From \| To \| By \|/)
    expect(moveSample(text, 'Freezer A, box 1, B3', { by: 'bob', now })).toBe(text)
  })

  it('records when a sample is used up', () => {
    const text = setSampleStatus(sample('S-0001', 'Freezer B, box 3, A1'), 'used up', { by: 'alice', now })
    expect(parseFrontmatter(text).fields.status).toBe('used up')
    expect(locationLog(text)).toEqual([
      { when: '2026-10-04 14:05', from: 'Freezer B, box 3, A1', to: 'used up', by: 'alice' }
    ])
    expect(setSampleStatus(text, 'used up', { by: 'alice', now })).toBe(text)
  })
})
