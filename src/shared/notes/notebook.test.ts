import { describe, expect, it } from 'vitest'
import { dailyNotePath, notebookFolder, parseDay } from './notebook'

describe('notebook paths', () => {
  it('keeps a local notebook in one folder', () => {
    expect(notebookFolder()).toBe('Notebook')
    expect(dailyNotePath('2026-09-30')).toBe('Notebook/2026/2026-09-30.md')
  })

  it('gives each person on a team vault their own notebook', () => {
    expect(dailyNotePath('2026-09-30', 'alice')).toBe('Notebooks/alice/2026/2026-09-30.md')
    expect(notebookFolder('a/b:c')).toBe('Notebooks/a b c')
  })

  it('uses the folder chosen in settings on a local vault only', () => {
    expect(dailyNotePath('2026-09-30', undefined, 'Lab book/2026')).toBe('Lab book/2026/2026/2026-09-30.md')
    expect(dailyNotePath('2026-09-30', 'alice', 'Lab book')).toBe('Notebooks/alice/2026/2026-09-30.md')
  })

  it('rejects days that are not real dates', () => {
    expect(() => dailyNotePath('2026-02-30')).toThrow()
    expect(() => dailyNotePath('26-9-30')).toThrow()
    expect(() => dailyNotePath('../2026-09-30')).toThrow()
    expect(parseDay('2028-02-29').getDate()).toBe(29)
  })
})
