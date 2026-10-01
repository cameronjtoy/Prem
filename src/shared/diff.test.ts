import { describe, expect, it } from 'vitest'
import { diffLines } from './diff'
import { groupSessions, type HistoryEntry } from './history'

describe('diffLines', () => {
  it('marks added, removed and unchanged lines', () => {
    expect(diffLines('a\nb\nc', 'a\nB\nc\nd')).toEqual([
      { type: 'same', text: 'a' },
      { type: 'removed', text: 'b' },
      { type: 'added', text: 'B' },
      { type: 'same', text: 'c' },
      { type: 'added', text: 'd' }
    ])
  })

  it('handles empty sides and identical text', () => {
    expect(diffLines('', 'x')).toEqual([
      { type: 'removed', text: '' },
      { type: 'added', text: 'x' }
    ])
    expect(diffLines('same', 'same')).toEqual([{ type: 'same', text: 'same' }])
  })

  it('keeps a moved line as one removal and one addition', () => {
    const out = diffLines('1\n2\n3', '2\n3\n1')
    expect(out.filter((l) => l.type !== 'same')).toEqual([
      { type: 'removed', text: '1' },
      { type: 'added', text: '1' }
    ])
  })
})

const entry = (n: number, minutes: number, author = 'alice', kind: HistoryEntry['kind'] = 'save'): HistoryEntry => ({
  n,
  time: new Date(Date.UTC(2026, 8, 30, 9, minutes)).toISOString(),
  author,
  kind,
  hash: String(n),
  size: 1,
  prev: '',
  id: String(n)
})

describe('groupSessions', () => {
  it('groups quick saves by one person, newest session first', () => {
    const sessions = groupSessions([
      entry(1, 0),
      entry(2, 3),
      entry(3, 30),
      entry(4, 31, 'bob'),
      entry(5, 32, '', 'external')
    ])
    expect(sessions.map((s) => s.map((e) => e.n))).toEqual([[5], [4], [3], [1, 2]])
  })
})
