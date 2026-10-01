import { describe, expect, it } from 'vitest'
import { movesFor, relativeUrl, relink, resolveRelative, type RelinkContext } from './relink'
import { createResolver } from './resolve'

const VAULT = [
  'Protocols/Plasmid miniprep.md',
  'Notebook/2026/Ligation.md',
  'Notebook/2026/2026-09-30.md',
  'Notebook/2026/attachments/gel 2026-09-30.png',
  'Notebook/2026/attachments/plate.csv',
  'Samples/S-0001.md',
  'Archive/S-0001.md'
]

/** Moves `from` to `to` in VAULT and relinks the note now at `notePath`. */
function after(from: string, to: string, content: string, oldNotePath: string): string {
  const moves = movesFor(from, to, VAULT)
  const afterPaths = VAULT.map((p) => moves.get(p.toLowerCase()) ?? p)
  const notePath = moves.get(oldNotePath.toLowerCase()) ?? oldNotePath
  const ctx: RelinkContext = {
    oldNotePath,
    notePath,
    moves,
    before: createResolver(VAULT),
    after: createResolver(afterPaths),
    existed: new Set(VAULT.map((p) => p.toLowerCase()))
  }
  return relink(content, ctx)
}

describe('movesFor', () => {
  it('moves a file, or everything inside a folder', () => {
    expect([...movesFor('Samples/S-0001.md', 'Samples/S-0001 pUC19.md', VAULT)]).toEqual([
      ['samples/s-0001.md', 'Samples/S-0001 pUC19.md']
    ])
    expect([...movesFor('Notebook/2026', 'Notebook/2026-old', VAULT).values()]).toEqual([
      'Notebook/2026-old/Ligation.md',
      'Notebook/2026-old/2026-09-30.md',
      'Notebook/2026-old/attachments/gel 2026-09-30.png',
      'Notebook/2026-old/attachments/plate.csv'
    ])
  })

  it("doesn't match folders that only share a prefix", () => {
    expect(movesFor('Notebook/20', 'X', VAULT).size).toBe(0)
  })
})

describe('relative links', () => {
  it('resolves against the note folder', () => {
    expect(resolveRelative('Notebook/2026', 'attachments/gel%202026-09-30.png')).toBe(
      'Notebook/2026/attachments/gel 2026-09-30.png'
    )
    expect(resolveRelative('Notebook/2026', '../../Samples/S-0001.md#Storage')).toBe('Samples/S-0001.md')
    expect(resolveRelative('', '../x.png')).toBeNull()
    expect(resolveRelative('a', 'https://example.com/x.png')).toBeNull()
    expect(resolveRelative('a', '#heading')).toBeNull()
  })

  it('writes the shortest relative path', () => {
    expect(relativeUrl('Notebook/2026', 'Notebook/2026/attachments/gel 1.png')).toBe('attachments/gel%201.png')
    expect(relativeUrl('Archive', 'Notebook/2026/attachments/a(1).png')).toBe(
      '../Notebook/2026/attachments/a%281%29.png'
    )
    expect(relativeUrl('', 'Samples/S-0001.md')).toBe('Samples/S-0001.md')
  })
})

describe('relink', () => {
  it('renames wikilinks to a renamed note, keeping heading, alias and embeds', () => {
    const text = 'See [[Plasmid miniprep]], [[plasmid miniprep#Steps|the steps]] and ![[Plasmid miniprep]].'
    expect(
      after('Protocols/Plasmid miniprep.md', 'Protocols/Miniprep (Qiagen).md', text, 'Notebook/2026/Ligation.md')
    ).toBe('See [[Miniprep (Qiagen)]], [[Miniprep (Qiagen)#Steps|the steps]] and ![[Miniprep (Qiagen)]].')
  })

  it('leaves bare-name links alone when a note only moves folder', () => {
    const text = 'Uses [[Plasmid miniprep]].'
    expect(after('Protocols/Plasmid miniprep.md', 'Methods/Plasmid miniprep.md', text, 'Samples/S-0001.md')).toBe(text)
  })

  it('updates path-style links when a note moves folder', () => {
    const text = 'Uses [[Protocols/Plasmid miniprep]].'
    expect(after('Protocols', 'Methods', text, 'Samples/S-0001.md')).toBe('Uses [[Methods/Plasmid miniprep]].')
  })

  it('keeps a bare name pointing at the same note when the move would make it resolve elsewhere', () => {
    // Two notes are called S-0001. From Ligation, [[S-0001]] resolves to Archive/S-0001 (the tie-break), so after
    // that one moves deeper the bare name would mean Samples/S-0001; the link becomes a path instead.
    const text = 'Old record: [[Archive/S-0001]] and [[S-0001]]; current [[Samples/S-0001]].'
    expect(after('Archive/S-0001.md', 'Archive/Old/S-0001.md', text, 'Notebook/2026/Ligation.md')).toBe(
      'Old record: [[Archive/Old/S-0001]] and [[Archive/Old/S-0001]]; current [[Samples/S-0001]].'
    )
  })

  it('switches a bare name to a path if the rename makes it ambiguous', () => {
    const text = 'From [[Ligation]].'
    expect(after('Notebook/2026/Ligation.md', 'Notebook/2026/S-0001.md', text, 'Protocols/Plasmid miniprep.md')).toBe(
      'From [[Notebook/2026/S-0001]].'
    )
  })

  it('updates links and embeds to a renamed attachment', () => {
    const text = '![gel](attachments/gel%202026-09-30.png)\n\n[plate data](attachments/plate.csv)'
    expect(
      after(
        'Notebook/2026/attachments/gel 2026-09-30.png',
        'Notebook/2026/attachments/gel colony PCR.png',
        text,
        'Notebook/2026/Ligation.md'
      )
    ).toBe('![gel](attachments/gel%20colony%20PCR.png)\n\n[plate data](attachments/plate.csv)')
  })

  it("keeps a moved note's images working from its new folder", () => {
    const text = '![gel](attachments/gel%202026-09-30.png)'
    expect(after('Notebook/2026/Ligation.md', 'Archive/Ligation.md', text, 'Notebook/2026/Ligation.md')).toBe(
      '![gel](../Notebook/2026/attachments/gel%202026-09-30.png)'
    )
  })

  it('needs no change when a note moves together with its attachments', () => {
    const text = '![gel](attachments/gel%202026-09-30.png) and [[Plasmid miniprep]]'
    expect(after('Notebook/2026', 'Projects/Reporter/2026', text, 'Notebook/2026/Ligation.md')).toBe(text)
  })

  it('updates relative links to notes', () => {
    const text = '[the sample](../../Samples/S-0001.md#Storage)'
    expect(after('Samples', 'Inventory', text, 'Notebook/2026/Ligation.md')).toBe(
      '[the sample](../../Inventory/S-0001.md#Storage)'
    )
  })

  it('leaves code, web links and links to files that never existed alone', () => {
    const text =
      '`[[Plasmid miniprep]]`\n\n```\n![x](attachments/gel%202026-09-30.png)\n```\n\n[web](https://example.com/a.png) ![missing](attachments/none.png)'
    expect(after('Notebook/2026', 'Elsewhere', text, 'Notebook/2026/Ligation.md')).toBe(text)
  })

  it('updates wikilinks in frontmatter', () => {
    const text = '---\ntype: run\nprotocol: "[[Plasmid miniprep]]"\n---\n'
    expect(after('Protocols/Plasmid miniprep.md', 'Protocols/Miniprep.md', text, 'Notebook/2026/2026-09-30.md')).toBe(
      '---\ntype: run\nprotocol: "[[Miniprep]]"\n---\n'
    )
  })

  it('handles angle-bracket links', () => {
    const text = '![gel](<attachments/gel 2026-09-30.png>)'
    expect(
      after(
        'Notebook/2026/attachments/gel 2026-09-30.png',
        'Notebook/2026/attachments/gel.png',
        text,
        'Notebook/2026/Ligation.md'
      )
    ).toBe('![gel](<attachments/gel.png>)')
  })

  it('returns the same string when nothing points at what moved', () => {
    const text = 'Nothing to see [[Samples/S-0001]]'
    expect(after('Protocols/Plasmid miniprep.md', 'Protocols/X.md', text, 'Notebook/2026/Ligation.md')).toBe(text)
  })
})
