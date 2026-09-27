import { describe, expect, it } from 'vitest'
import { normalizeVaultPath, sanitizeFileName } from './paths'
import { formatDate, renderTemplate } from './templates'

const now = new Date(2026, 8, 27, 9, 5)

describe('renderTemplate', () => {
  it('fills title, date and time', () => {
    const { content, cursor } = renderTemplate('# {{title}}\n{{date}} {{time}} {{ date:DD/MM/YYYY }}', {
      title: 'Deploy',
      now
    })
    expect(content).toBe('# Deploy\n2026-09-27 09:05 27/09/2026')
    expect(cursor).toBeNull()
  })

  it('returns the cursor position and removes every cursor marker', () => {
    const { content, cursor } = renderTemplate('Hi {{cursor}}there{{cursor}}', { title: 'x', now })
    expect(content).toBe('Hi there')
    expect(cursor).toBe(3)
  })

  it('leaves unknown placeholders alone', () => {
    expect(renderTemplate('{{owner}}', { title: 'x', now }).content).toBe('{{owner}}')
  })
})

describe('formatDate', () => {
  it('formats with padding', () => {
    expect(formatDate(new Date(2026, 0, 3, 4, 7), 'YYYY-MM-DD HH:mm')).toBe('2026-01-03 04:07')
  })
})

describe('paths', () => {
  it('normalizes vault paths', () => {
    expect(normalizeVaultPath('a\\b/./c.md')).toBe('a/b/c.md')
    expect(normalizeVaultPath('')).toBe('')
  })

  it('rejects traversal and absolute paths', () => {
    expect(() => normalizeVaultPath('../secret.md')).toThrow()
    expect(() => normalizeVaultPath('a/../../b')).toThrow()
    expect(() => normalizeVaultPath('/etc/passwd')).toThrow()
    expect(() => normalizeVaultPath('C:\\Windows')).toThrow()
  })

  it('sanitizes file names', () => {
    expect(sanitizeFileName('What: is/this?')).toBe('What is this')
    expect(sanitizeFileName('  ..hidden')).toBe('hidden')
    expect(sanitizeFileName('///')).toBe('Untitled')
  })
})
