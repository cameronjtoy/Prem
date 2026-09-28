import { describe, expect, it } from 'vitest'
import { Access } from './access'

const access = new Access({ '': 'read', Runbooks: 'write', 'Runbooks/Secrets': 'none', Finance: 'none' })

describe('Access', () => {
  it('uses the rule for the deepest matching folder', () => {
    expect(access.levelFor('Welcome.md')).toBe('read')
    expect(access.levelFor('Runbooks/Deploy.md')).toBe('write')
    expect(access.levelFor('Runbooks/Secrets/keys.md')).toBe('none')
    expect(access.levelFor('Finance/Unit economics.md')).toBe('none')
  })

  it('does not treat a folder name prefix as a parent', () => {
    expect(access.levelFor('RunbooksArchive/Old.md')).toBe('read')
  })

  it('ignores case, so a differently cased path cannot dodge a rule', () => {
    expect(access.levelFor('finance/Unit economics.md')).toBe('none')
    expect(access.levelFor('RUNBOOKS/Deploy.md')).toBe('write')
  })

  it('denies everything no rule covers', () => {
    const scoped = new Access({ Runbooks: 'read' })
    expect(scoped.canRead('Welcome.md')).toBe(false)
    expect(scoped.canRead('Runbooks/Deploy.md')).toBe(true)
    expect(scoped.canWrite('Runbooks/Deploy.md')).toBe(false)
  })

  it('shows folders that lead to something readable', () => {
    const scoped = new Access({ 'Teams/Platform': 'read' })
    expect(scoped.canSee('Teams', 'folder')).toBe(true)
    expect(scoped.canSee('Teams/Other', 'folder')).toBe(false)
    expect(scoped.canSee('Teams/notes.md', 'file')).toBe(false)
  })

  it('only allows moving a folder when everything inside it is writable', () => {
    expect(access.canWriteTree('Runbooks/Deploy.md')).toBe(true)
    expect(access.canWriteTree('Runbooks')).toBe(false)
    expect(new Access({ '': 'write' }).canWriteTree('Runbooks')).toBe(true)
  })

  it('rejects unknown levels', () => {
    expect(() => new Access({ '': 'admin' as never })).toThrow()
  })
})
