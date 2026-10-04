import { describe, expect, it } from 'vitest'
import { Access } from '@shared/vault/access'
import { addPerson, checkName, describePeople, newLabConfig, removePerson, replaceToken, roleAccess } from './lab'

const shared = { shareNotebooks: true }
const closed = { shareNotebooks: false }
const hash = (c: string): string => `sha256:${c.repeat(64)}`
const access = (...args: Parameters<typeof roleAccess>): Access => new Access(roleAccess(...args))

describe('roleAccess', () => {
  it('lets a member write their own notebook and samples, and read protocols', () => {
    const alice = access('member', 'alice', shared)
    expect(alice.canWrite('Notebooks/alice/2026/2026-10-01.md')).toBe(true)
    expect(alice.canWrite('Notebooks/alice/Runs/2026/Miniprep run.md')).toBe(true)
    expect(alice.canWrite('Samples/S-0004.md')).toBe(true)
    expect(alice.canRead('Protocols/Miniprep.md')).toBe(true)
    expect(alice.canWrite('Protocols/Miniprep.md')).toBe(false)
    expect(alice.canWrite('templates/Experiment.md')).toBe(false)
  })

  it("lets members read but not write each other's notebooks when notebooks are shared", () => {
    const alice = access('member', 'alice', shared)
    expect(alice.canRead('Notebooks/bob/2026/2026-10-01.md')).toBe(true)
    expect(alice.canWrite('Notebooks/bob/2026/2026-10-01.md')).toBe(false)
  })

  it("hides other members' notebooks when notebooks are private", () => {
    const alice = access('member', 'alice', closed)
    expect(alice.canRead('Notebooks/bob/2026/2026-10-01.md')).toBe(false)
    expect(alice.canSee('Notebooks/bob', 'folder')).toBe(false)
    expect(alice.canWrite('Notebooks/alice/x.md')).toBe(true)
    // The Notebooks folder stays visible so alice can reach her own.
    expect(alice.canSee('Notebooks', 'folder')).toBe(true)
  })

  it('lets the PI edit shared material and read every notebook, but write only their own', () => {
    const pat = access('pi', 'Pat Lee', closed)
    expect(pat.canWrite('Protocols/Miniprep.md')).toBe(true)
    expect(pat.canWrite('templates/Experiment.md')).toBe(true)
    expect(pat.canWrite('Samples/S-0001.md')).toBe(true)
    expect(pat.canRead('Notebooks/alice/2026/2026-10-01.md')).toBe(true)
    expect(pat.canWrite('Notebooks/alice/2026/2026-10-01.md')).toBe(false)
    expect(pat.canWrite('Notebooks/Pat Lee/2026/2026-10-01.md')).toBe(true)
  })

  it('lets a viewer read but never write', () => {
    const viewer = access('viewer', 'auditor', shared)
    expect(viewer.canRead('Protocols/Miniprep.md')).toBe(true)
    expect(viewer.canRead('Notebooks/alice/x.md')).toBe(true)
    expect(viewer.canWrite('Samples/S-0001.md')).toBe(false)
    expect(access('viewer', 'auditor', closed).canRead('Notebooks/alice/x.md')).toBe(false)
  })
})

describe('people in the config', () => {
  const base = newLabConfig({ vault: 'vault', host: '127.0.0.1', port: 4747, shareNotebooks: true })

  it('adds people with their role and the access it gives', () => {
    const config = addPerson(addPerson(base, 'pat', 'pi', hash('a')), 'alice', 'member', hash('b'))
    expect(config.users.map((u) => [u.name, u.role])).toEqual([
      ['pat', 'pi'],
      ['alice', 'member']
    ])
    expect(config.users[1].access['Notebooks/alice']).toBe('write')
    expect(describePeople(config)).toEqual([
      'pat (pi): writes everything, Notebooks/pat',
      'alice (member): writes Notebooks/alice, Samples, Jobs'
    ])
  })

  it('uses the notebook privacy chosen for the lab', () => {
    const config = addPerson({ ...base, lab: { shareNotebooks: false } }, 'alice', 'member', hash('a'))
    expect(config.users[0].access.Notebooks).toBe('none')
  })

  it('refuses duplicate names, ignoring case', () => {
    const config = addPerson(base, 'alice', 'member', hash('a'))
    expect(() => addPerson(config, 'Alice', 'member', hash('b'))).toThrow(/already on the server/)
  })

  it('refuses names that would make odd folders', () => {
    for (const name of ['', '../etc', 'a/b', '.hidden', 'x'.repeat(65)]) expect(() => checkName(name)).toThrow()
    expect(checkName(" Siobhán O'Neil ")).toBe("Siobhán O'Neil")
  })

  it('removes people, but never the last one', () => {
    const config = addPerson(addPerson(base, 'pat', 'pi', hash('a')), 'alice', 'member', hash('b'))
    expect(removePerson(config, 'ALICE').users.map((u) => u.name)).toEqual(['pat'])
    expect(() => removePerson(removePerson(config, 'alice'), 'pat')).toThrow(/only person/)
    expect(() => removePerson(config, 'bob')).toThrow(/nobody called bob/)
  })

  it('replaces a token and keeps everything else', () => {
    const config = addPerson(base, 'alice', 'member', hash('a'))
    const next = replaceToken(config, 'alice', hash('c'))
    expect(next.users[0]).toEqual({ ...config.users[0], tokenHash: hash('c') })
  })
})
