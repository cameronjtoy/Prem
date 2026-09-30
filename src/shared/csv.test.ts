import { describe, expect, it } from 'vitest'
import { parseDelimited } from './csv'

describe('parseDelimited', () => {
  it('parses plain and quoted CSV fields', () => {
    const { rows } = parseDelimited('well,od600,note\r\nA1,0.51,"ok, clear"\nA2,0.48,"said ""hi"""\n', ',')
    expect(rows).toEqual([
      ['well', 'od600', 'note'],
      ['A1', '0.51', 'ok, clear'],
      ['A2', '0.48', 'said "hi"']
    ])
  })

  it('keeps line breaks inside quotes and skips blank lines', () => {
    expect(parseDelimited('a,"two\nlines"\n\nb,c', ',').rows).toEqual([
      ['a', 'two\nlines'],
      ['b', 'c']
    ])
  })

  it('reads TSV and strips a byte-order mark', () => {
    expect(parseDelimited('﻿x\ty\n1\t2', '\t').rows).toEqual([
      ['x', 'y'],
      ['1', '2']
    ])
  })

  it('stops at the row limit and says so', () => {
    const { rows, truncated } = parseDelimited('1\n2\n3\n4\n', ',', 2)
    expect(rows).toEqual([['1'], ['2']])
    expect(truncated).toBe(true)
    expect(parseDelimited('1\n2\n', ',', 2).truncated).toBe(false)
  })
})
