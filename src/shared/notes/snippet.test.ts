import { describe, expect, it } from 'vitest'
import { plainSnippet } from './snippet'

describe('plainSnippet', () => {
  it('removes list markers, checkboxes, headings and quotes', () => {
    expect(plainSnippet('- [[Ligation of insert into pUC19]]')).toBe('[[Ligation of insert into pUC19]]')
    expect(plainSnippet('  1. [x] Pellet cells ✓ 14:12 [[S-0001]]')).toBe('Pellet cells ✓ 14:12 [[S-0001]]')
    expect(plainSnippet('## Samples from [[Freezer B]]')).toBe('Samples from [[Freezer B]]')
    expect(plainSnippet('> Note from [[PI meeting]]')).toBe('Note from [[PI meeting]]')
  })

  it('removes emphasis, code and link syntax', () => {
    expect(plainSnippet("- **Notebook**: one person's entries. Press **⌘T** for [[Today]]")).toBe(
      "Notebook: one person's entries. Press ⌘T for [[Today]]"
    )
    expect(plainSnippet('Use `T4 ligase` from _the_ [kit sheet](attachments/kit.pdf) with [[Ligation]]')).toBe(
      'Use T4 ligase from the kit sheet with [[Ligation]]'
    )
    expect(plainSnippet('![gel](attachments/gel.png) ~~old~~ <b>new</b> [[Gel]]')).toBe('gel old new [[Gel]]')
  })

  it('leaves wikilinks with underscores and stars alone', () => {
    expect(plainSnippet('see [[run_2026_09*draft]] and *this*')).toBe('see [[run_2026_09*draft]] and this')
  })

  it('keeps arithmetic and snake_case words', () => {
    expect(plainSnippet('2 * 3 * 4 wells in plate_layout_v2 [[Plate]]')).toBe(
      '2 * 3 * 4 wells in plate_layout_v2 [[Plate]]'
    )
  })

  it('drops the embed mark from embedded notes', () => {
    expect(plainSnippet('![[Protocol card]]')).toBe('[[Protocol card]]')
  })
})
