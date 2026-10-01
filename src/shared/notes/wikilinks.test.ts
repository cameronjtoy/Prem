import { describe, expect, it } from 'vitest'
import { maskNonLinkText, parseWikilinks, splitLinkText } from './wikilinks'

describe('parseWikilinks', () => {
  it('finds plain, aliased, heading and embed links with line numbers', () => {
    const md = 'See [[Deploy]] and [[Billing|the billing doc]].\nAlso [[Runbooks/Restart#Step 2]] and ![[Diagram]]'
    const links = parseWikilinks(md)
    expect(links.map((l) => [l.target, l.alias, l.heading, l.embed, l.line])).toEqual([
      ['Deploy', undefined, undefined, false, 0],
      ['Billing', 'the billing doc', undefined, false, 0],
      ['Runbooks/Restart', undefined, 'Step 2', false, 1],
      ['Diagram', undefined, undefined, true, 1]
    ])
    expect(md.slice(links[0].from, links[0].to)).toBe('[[Deploy]]')
  })

  it('ignores links inside code and math', () => {
    const md = [
      '```',
      '[[InFence]]',
      '```',
      'Inline `[[InCode]]` and $[[InMath]]$ but [[Real]]',
      '$$',
      '[[InBlockMath]]',
      '$$'
    ].join('\n')
    expect(parseWikilinks(md).map((l) => l.target)).toEqual(['Real'])
  })

  it('does not treat prices as math', () => {
    expect(parseWikilinks('Costs $5 and [[Budget]] is $10').map((l) => l.target)).toEqual(['Budget'])
  })

  it('skips empty links', () => {
    expect(parseWikilinks('Related: [[ ]]')).toEqual([])
  })
})

describe('maskNonLinkText', () => {
  it('preserves length and newlines', () => {
    const md = 'a `b` c\n```\nx\n```\n$y$'
    const masked = maskNonLinkText(md)
    expect(masked.length).toBe(md.length)
    expect(masked.split('\n').length).toBe(md.split('\n').length)
  })
})

describe('splitLinkText', () => {
  it('splits target, heading and alias', () => {
    expect(splitLinkText('Note#Section|Shown')).toEqual({ target: 'Note', heading: 'Section', alias: 'Shown' })
    expect(splitLinkText(' Note ')).toEqual({ target: 'Note', heading: undefined, alias: undefined })
  })
})
