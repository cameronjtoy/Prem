import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isVaultError } from '@shared/errors'
import { LocalFsProvider } from './LocalFsProvider'

let root: string
let vault: LocalFsProvider

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'prem-history-')))
  vault = new LocalFsProvider(root)
})

afterEach(async () => {
  await vault.dispose()
  await rm(root, { recursive: true, force: true })
})

const kinds = async (p: string): Promise<string[]> => (await vault.history(p)).map((e) => `${e.kind}:${e.author}`)

describe('note history', () => {
  it('keeps every saved version with its author, and skips saves that change nothing', async () => {
    await vault.write('Notebook/Gel.md', 'v1', { author: 'alice' })
    await vault.write('Notebook/Gel.md', 'v2', { author: 'alice' })
    await vault.write('Notebook/Gel.md', 'v2', { author: 'alice' })
    await vault.write('Notebook/Gel.md', 'v3', { author: 'bob' })
    const entries = await vault.history('Notebook/Gel.md')
    expect(entries.map((e) => [e.n, e.author])).toEqual([
      [1, 'alice'],
      [2, 'alice'],
      [3, 'bob']
    ])
    expect(await vault.readVersion('Notebook/Gel.md', entries[1].id)).toBe('v2')
    expect((await vault.verifyHistory('Notebook/Gel.md')).ok).toBe(true)
  })

  it('detects an edited, removed or reordered history entry', async () => {
    for (const v of ['a', 'b', 'c']) await vault.write('N.md', v, { author: 'alice' })
    const log = path.join(root, '.prem', 'history', 'N.md.jsonl')
    const lines = (await readFile(log, 'utf8')).trim().split('\n')

    await writeFile(log, lines.map((l, i) => (i === 1 ? l.replace('"alice"', '"mallory"') : l)).join('\n') + '\n')
    expect(await new LocalFsProvider(root).verifyHistory('N.md')).toEqual({ ok: false, brokenAt: 2 })

    await writeFile(log, [lines[0], lines[2]].join('\n') + '\n')
    expect((await new LocalFsProvider(root).verifyHistory('N.md')).ok).toBe(false)

    await writeFile(log, [lines[1], lines[0], lines[2]].join('\n') + '\n')
    expect((await new LocalFsProvider(root).verifyHistory('N.md')).ok).toBe(false)
  })

  it('notices when a stored version has been tampered with', async () => {
    await vault.write('N.md', 'original', { author: 'alice' })
    const [entry] = await vault.history('N.md')
    const { gzipSync } = await import('node:zlib')
    await writeFile(path.join(root, '.prem', 'objects', entry.hash.slice(0, 2), `${entry.hash}.gz`), gzipSync('forged'))
    const err = await vault.readVersion('N.md', entry.id).catch((e: unknown) => e)
    expect(isVaultError(err) && err.message).toMatch(/damaged/)
  })

  it('moves history with a renamed note or folder, and keeps it after deletion', async () => {
    await vault.write('Drafts/Plan.md', 'plan', { author: 'alice' })
    await vault.rename('Drafts/Plan.md', 'Drafts/Final plan.md', 'alice')
    expect(await kinds('Drafts/Final plan.md')).toEqual(['save:alice', 'renamed:alice'])
    expect(await vault.history('Drafts/Plan.md')).toEqual([])

    await vault.rename('Drafts', 'Archive', 'bob')
    expect(await kinds('Archive/Final plan.md')).toEqual(['save:alice', 'renamed:alice', 'renamed:bob'])
    expect((await vault.history('Archive/Final plan.md')).at(-1)?.from).toBe('Drafts/Final plan.md')

    await vault.remove('Archive', 'carol')
    const after = await vault.history('Archive/Final plan.md')
    expect(after.at(-1)).toMatchObject({ kind: 'deleted', author: 'carol' })
    expect(await vault.readVersion('Archive/Final plan.md', after[0].id)).toBe('plan')
    expect((await vault.verifyHistory('Archive/Final plan.md')).ok).toBe(true)
  })

  it('records edits made outside Prem, without an author', async () => {
    await vault.write('N.md', 'mine', { author: 'alice' })
    const stop = vault.watch(() => {})
    await new Promise((r) => setTimeout(r, 300))
    await writeFile(path.join(root, 'N.md'), 'edited in another app')
    for (let i = 0; i < 40 && (await vault.history('N.md')).length < 2; i++) await new Promise((r) => setTimeout(r, 100))
    stop()
    expect(await kinds('N.md')).toEqual(['save:alice', 'external:'])
  })

  it("won't read or write hidden files, so history and trash can't be reached through the vault", async () => {
    await vault.write('N.md', 'x', { author: 'alice' })
    for (const attempt of [
      vault.read('.prem/history/N.md.jsonl'),
      vault.readBinary('.trash/anything'),
      vault.write('.git/config.md', 'x'),
      vault.exists('Notes/.hidden/x.md')
    ]) {
      const err = await attempt.then(() => null, (e: unknown) => e)
      expect(isVaultError(err, 'INVALID_PATH')).toBe(true)
    }
  })
})

describe('notes that existed before history', () => {
  it('records the original content before the first save, so it can be restored', async () => {
    await writeFile(path.join(root, 'Old.md'), 'written years ago')
    await vault.write('Old.md', 'first edit in Prem', { author: 'alice' })
    const entries = await vault.history('Old.md')
    expect(entries.map((e) => `${e.kind}:${e.author}`)).toEqual(['external:', 'save:alice'])
    expect(await vault.readVersion('Old.md', entries[0].id)).toBe('written years ago')
  })

  it("doesn't add a baseline for a brand new note", async () => {
    await vault.write('New.md', 'hello', { author: 'alice', createOnly: true })
    expect((await vault.history('New.md')).map((e) => e.kind)).toEqual(['save'])
  })
})
