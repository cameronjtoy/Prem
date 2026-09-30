import { describe, expect, it } from 'vitest'
import { parseQuery, SearchIndex } from './search'

const index = new SearchIndex()
index.build([
  { path: 'Protocols/Miniprep.md', content: '# Miniprep\n\n## Steps\n1. [ ] Pellet 2 mL culture\n2. [ ] Add P2 lysis buffer' },
  { path: 'Notebook/2026/2026-09-30.md', content: '# 2026-09-30\n\nRan the [[Miniprep]] on S-0042. Yield was low, try fresh culture.' },
  { path: 'Notebook/Gel check.md', content: 'Gel looked clean.\nLadder: 1 kb.' },
  { path: 'templates/Protocol.md', content: '# {{title}}\n\n## Steps\nculture' }
])

describe('parseQuery', () => {
  it('splits words and keeps quoted phrases together', () => {
    expect(parseQuery('  Lysis "fresh culture"  lysis ')).toEqual(['lysis', 'fresh culture'])
    expect(parseQuery('   ')).toEqual([])
  })
})

describe('SearchIndex', () => {
  it('finds notes containing every term, ranking title matches first', () => {
    const hits = index.search('miniprep')
    expect(hits.map((h) => h.path)).toEqual(['Protocols/Miniprep.md', 'Notebook/2026/2026-09-30.md'])
    expect(hits[0].titleRanges).toEqual([[0, 8]])
  })

  it('requires all terms, ignores case, and leaves templates out', () => {
    expect(index.search('CULTURE yield').map((h) => h.path)).toEqual(['Notebook/2026/2026-09-30.md'])
    expect(index.search('culture').map((h) => h.path)).not.toContain('templates/Protocol.md')
    expect(index.search('culture nonexistent')).toEqual([])
  })

  it('matches folder names and quoted phrases', () => {
    expect(index.search('notebook gel').map((h) => h.path)).toEqual(['Notebook/Gel check.md'])
    expect(index.search('"fresh culture"').map((h) => h.path)).toEqual(['Notebook/2026/2026-09-30.md'])
    expect(index.search('"culture fresh"')).toEqual([])
  })

  it('returns the matching line, highlight ranges and where to put the cursor', () => {
    const [hit] = index.search('lysis')
    expect(hit.matches).toHaveLength(1)
    const m = hit.matches[0]
    expect(m.line).toBe(5)
    expect(m.text).toBe('2. [ ] Add P2 lysis buffer')
    expect(m.ranges).toEqual([[14, 19]])
    const content = '# Miniprep\n\n## Steps\n1. [ ] Pellet 2 mL culture\n2. [ ] Add P2 lysis buffer'
    expect(content.slice(m.offset, m.offset + 5)).toBe('lysis')
  })

  it('shortens long lines around the match', () => {
    const idx = new SearchIndex()
    idx.upsert('Long.md', 'x'.repeat(500) + ' needle ' + 'y'.repeat(500))
    const m = idx.search('needle')[0].matches[0]
    expect(m.text.startsWith('…')).toBe(true)
    expect(m.text.endsWith('…')).toBe(true)
    const [s, e] = m.ranges[0]
    expect(m.text.slice(s, e)).toBe('needle')
  })

  it('stays current as notes change or go away', () => {
    const idx = new SearchIndex()
    idx.upsert('A/One.md', 'alpha')
    idx.upsert('A/Two.md', 'alpha')
    idx.upsert('A/One.md', 'beta')
    expect(idx.search('alpha').map((h) => h.path)).toEqual(['A/Two.md'])
    idx.removeFolder('A')
    expect(idx.size).toBe(0)
  })

  it('searches 5,000 notes quickly', () => {
    const idx = new SearchIndex()
    const words = ['buffer', 'culture', 'plasmid', 'ligase', 'primer', 'gel', 'column', 'elute', 'spin', 'incubate']
    for (let i = 0; i < 5000; i++) {
      const body = Array.from({ length: 700 }, (_, j) => words[(i * 7 + j * 3) % words.length]).join(' ')
      idx.upsert(`Notebook/${i}.md`, `# Entry ${i}\n\n${body}\nsample S-${String(i).padStart(4, '0')}`)
    }
    idx.search('warm up')
    const started = performance.now()
    const hits = idx.search('plasmid S-4242')
    const elapsed = performance.now() - started
    expect(hits.map((h) => h.path)).toEqual(['Notebook/4242.md'])
    expect(elapsed).toBeLessThan(200)
  })
})
