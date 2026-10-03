import { describe, expect, it } from 'vitest'
import { column, escapeCell, findSection, formatTable, parseTable, splitRow } from './tables'

describe('splitRow', () => {
  it('splits cells and trims them', () => {
    expect(splitRow('| a | b |  c  |')).toEqual(['a', 'b', 'c'])
  })

  it('keeps pipes inside links and escaped pipes', () => {
    expect(splitRow('| [[Note|alias]] | a \\| b |')).toEqual(['[[Note|alias]]', 'a | b'])
  })

  it('keeps blank cells', () => {
    expect(splitRow('| x |  | z |')).toEqual(['x', '', 'z'])
  })
})

describe('parseTable', () => {
  const text = 'Intro\n\n| Stage | Protocol |\n| --- | :---: |\n| Grow | [[Culture]] |\n| Check |\n\nAfter\n'

  it('finds the first table and pads short rows', () => {
    const table = parseTable(text)!
    expect(table.header).toEqual(['Stage', 'Protocol'])
    expect(table.rows).toEqual([
      ['Grow', '[[Culture]]'],
      ['Check', '']
    ])
    expect(text.slice(table.from, table.to)).toBe(
      '| Stage | Protocol |\n| --- | :---: |\n| Grow | [[Culture]] |\n| Check |\n'
    )
  })

  it('returns null when there is no table', () => {
    expect(parseTable('just | some | pipes\n')).toBeNull()
  })

  it('handles a header-only table at the end of the text', () => {
    const table = parseTable('| A | B |\n| --- | --- |')!
    expect(table.rows).toEqual([])
    expect(table.to).toBe('| A | B |\n| --- | --- |'.length)
  })
})

describe('formatTable', () => {
  it('writes a table that parses back to the same cells', () => {
    const rows = [
      ['a | b', '[[Note|alias]]'],
      ['', 'x']
    ]
    const md = formatTable(['One', 'Two'], rows)
    expect(md).toBe('| One | Two |\n| --- | --- |\n| a \\| b | [[Note|alias]] |\n|   | x |\n')
    expect(parseTable(md)!.rows).toEqual(rows)
  })

  it('escapes line breaks', () => {
    expect(escapeCell('two\nlines')).toBe('two lines')
  })
})

describe('findSection', () => {
  const text = '# T\n\n## Stages\n| a |\n\n## Stage log\nrows\n'

  it('finds a section by exact heading, up to the next one', () => {
    const s = findSection(text, 'Stages')!
    expect(text.slice(s.from, s.to)).toBe('| a |\n\n')
    const log = findSection(text, 'stage log')!
    expect(text.slice(log.from, log.to)).toBe('rows\n')
  })

  it('returns null for a missing section', () => {
    expect(findSection(text, 'Notes')).toBeNull()
  })
})

it('column finds a header ignoring case', () => {
  expect(column({ header: ['Stage', 'Run'] }, 'run')).toBe(1)
  expect(column({ header: ['Stage'] }, 'By')).toBe(-1)
})
