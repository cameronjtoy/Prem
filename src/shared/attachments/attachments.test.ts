import { describe, expect, it } from 'vitest'
import {
  attachmentFileName,
  attachmentFolder,
  attachmentKind,
  attachmentMarkdown,
  isSafeToOpen,
  numberedName,
  resolveAttachment
} from './attachments'

describe('attachments', () => {
  it('stores attachments next to the note', () => {
    expect(attachmentFolder('Notebook/2026/Gel run.md')).toBe('Notebook/2026/attachments')
    expect(attachmentFolder('Welcome.md')).toBe('attachments')
  })

  it('embeds previewable files and links everything else, relative to the note', () => {
    expect(attachmentMarkdown('Notebook/Gel.md', 'Notebook/attachments/gel image.png')).toBe(
      '![gel image.png](attachments/gel%20image.png)'
    )
    expect(attachmentMarkdown('Notebook/Gel.md', 'Notebook/attachments/plate.csv')).toBe(
      '![plate.csv](attachments/plate.csv)'
    )
    expect(attachmentMarkdown('Notebook/Gel.md', 'Notebook/attachments/trace.ab1')).toBe(
      '[trace.ab1](attachments/trace.ab1)'
    )
  })

  it('resolves links relative to the note and refuses to leave the vault', () => {
    expect(resolveAttachment('Notebook/Gel.md', 'attachments/gel%20image.png')).toBe(
      'Notebook/attachments/gel image.png'
    )
    expect(resolveAttachment('Notebook/2026/Gel.md', '../shared/ladder.png')).toBe('Notebook/shared/ladder.png')
    expect(resolveAttachment('Gel.md', '../../etc/passwd')).toBeNull()
    expect(resolveAttachment('Gel.md', 'https://example.com/a.png')).toBeNull()
    expect(resolveAttachment('Gel.md', 'Other%20note.md')).toBeNull()
  })

  it('round-trips names with spaces and brackets', () => {
    const md = attachmentMarkdown('A/Note.md', 'A/attachments/run (2).pdf')
    const url = /\]\((.*)\)$/.exec(md)![1]
    expect(resolveAttachment('A/Note.md', url)).toBe('A/attachments/run (2).pdf')
  })

  it('cleans names and numbers duplicates before the extension', () => {
    expect(attachmentFileName('gel (final)?.png')).toBe('gel (final).png')
    expect(attachmentFileName('trace (A1).ab1')).toBe('trace (A1).ab1')
    expect(() => attachmentFileName('notes.md')).toThrow()
    expect(numberedName('gel.png', 2)).toBe('gel 2.png')
    expect(numberedName('README', 1)).toBe('README 1')
  })

  it('only opens known data formats directly', () => {
    expect(attachmentKind('a.JPG')).toBe('image')
    expect(attachmentKind('a.tsv')).toBe('table')
    expect(isSafeToOpen('run.fasta')).toBe(true)
    expect(isSafeToOpen('setup.exe')).toBe(false)
    expect(isSafeToOpen('analysis.py')).toBe(false)
    expect(isSafeToOpen('noextension')).toBe(false)
  })
})
