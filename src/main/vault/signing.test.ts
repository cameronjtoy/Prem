import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isVaultError } from '@shared/vault/errors'
import { recordStatus } from '@shared/records/signatures'
import { LocalFsProvider } from './LocalFsProvider'

let root: string
let vault: LocalFsProvider

beforeEach(async () => {
  root = await realpath(await mkdtemp(path.join(tmpdir(), 'prem-sign-')))
  vault = new LocalFsProvider(root)
})

afterEach(async () => {
  await vault.dispose()
  await rm(root, { recursive: true, force: true })
})

async function code(pending: Promise<unknown>): Promise<string | null> {
  const err = await pending.then(
    () => null,
    (e: unknown) => e
  )
  return isVaultError(err) ? err.code : err === null ? null : String(err)
}

describe('signing records', () => {
  it('signs the saved content, locks the note, and records who and when', async () => {
    await vault.write('Run.md', 'results: 42 ng/µL', { author: 'alice' })
    const status = await vault.sign('Run.md', 'alice', 'Results reviewed')
    expect(status).toMatchObject({ state: 'signed', locked: true, chainOk: true, changedOutside: false })
    expect(status.signature).toMatchObject({ by: 'alice', statement: 'Results reviewed' })
    expect(await code(vault.write('Run.md', 'results: 99 ng/µL', { author: 'alice' }))).toBe('LOCKED')
    expect(await readFile(path.join(root, 'Run.md'), 'utf8')).toBe('results: 42 ng/µL')
    expect(await code(vault.sign('Run.md', 'alice'))).toBe('LOCKED')
  })

  it('signs a note that existed before Prem, recording its content first', async () => {
    await writeFile(path.join(root, 'Old.md'), 'paper notebook, transcribed')
    await vault.sign('Old.md', 'alice')
    const kinds = (await vault.history('Old.md')).map((e) => e.kind)
    expect(kinds).toEqual(['external', 'signed'])
  })

  it('lets someone else witness, but not the signer, and not twice', async () => {
    await vault.write('Run.md', 'data', { author: 'alice' })
    expect(await code(vault.witness('Run.md', 'pi'))).toBe('INVALID_ARGUMENT')
    await vault.sign('Run.md', 'alice')
    expect(await code(vault.witness('Run.md', 'alice'))).toBe('INVALID_ARGUMENT')
    const status = await vault.witness('Run.md', 'pi')
    expect(status.state).toBe('witnessed')
    expect(status.witnesses.map((w) => w.by)).toEqual(['pi'])
    expect(await code(vault.witness('Run.md', 'pi'))).toBe('EXISTS')
  })

  it('allows changes only as amendments with a reason, and keeps the signed version', async () => {
    await vault.write('Run.md', 'yield 40', { author: 'alice' })
    await vault.sign('Run.md', 'alice')
    await vault.witness('Run.md', 'pi')
    expect(await code(vault.write('Run.md', 'yield 45', { author: 'alice', amendReason: '   ' }))).toBe('LOCKED')
    await vault.write('Run.md', 'yield 45', { author: 'alice', amendReason: 'Transcription error: 45, not 40' })
    let status = await vault.recordStatus('Run.md')
    expect(status).toMatchObject({ state: 'amended', locked: false, timesSigned: 1 })
    expect(status.amendment).toMatchObject({ by: 'alice', reason: 'Transcription error: 45, not 40' })
    // Further edits while amended are ordinary saves, until it's signed again.
    await vault.write('Run.md', 'yield 45 (checked)', { author: 'alice' })
    status = await vault.sign('Run.md', 'alice')
    expect(status).toMatchObject({ state: 'signed', timesSigned: 2 })
    const entries = await vault.history('Run.md')
    expect(entries.map((e) => e.kind)).toEqual(['save', 'signed', 'witnessed', 'amended', 'save', 'signed'])
    expect(await vault.readVersion('Run.md', entries[1].id)).toBe('yield 40')
  })

  it("won't delete a signed note, or a folder holding one, but lets it be moved", async () => {
    await vault.write('Runs/2026/Run.md', 'data', { author: 'alice' })
    await vault.sign('Runs/2026/Run.md', 'alice')
    expect(await code(vault.remove('Runs/2026/Run.md', 'alice'))).toBe('LOCKED')
    expect(await code(vault.remove('Runs', 'alice'))).toBe('LOCKED')
    await vault.rename('Runs', 'Archive', 'alice')
    expect((await vault.recordStatus('Archive/2026/Run.md')).state).toBe('signed')
  })

  it('flags a signed note that was changed while Prem was closed', async () => {
    await vault.write('Run.md', 'signed text', { author: 'alice' })
    await vault.sign('Run.md', 'alice')
    await writeFile(path.join(root, 'Run.md'), 'quietly edited')
    const reopened = new LocalFsProvider(root)
    const status = await reopened.recordStatus('Run.md')
    expect(status).toMatchObject({ locked: true, changedOutside: true, chainOk: true })
    expect(await code(reopened.witness('Run.md', 'pi'))).toBe('CONFLICT')
    const signed = (await reopened.history('Run.md')).find((e) => e.kind === 'signed')!
    expect(await reopened.readVersion('Run.md', signed.id)).toBe('signed text')
  })

  it('reports a tampered signature as a broken chain', async () => {
    await vault.write('Run.md', 'data', { author: 'alice' })
    await vault.sign('Run.md', 'alice')
    const log = path.join(root, '.prem', 'history', 'Run.md.jsonl')
    await writeFile(
      log,
      (await readFile(log, 'utf8')).replace('"author":"alice","kind":"signed"', '"author":"mallory","kind":"signed"')
    )
    expect((await new LocalFsProvider(root).recordStatus('Run.md')).chainOk).toBe(false)
  })

  it('works the status out from the history alone', async () => {
    await vault.write('Run.md', 'a', { author: 'alice' })
    await vault.sign('Run.md', 'alice')
    await vault.write('Run.md', 'b', { author: 'alice', amendReason: 'typo' })
    expect(recordStatus(await vault.history('Run.md'))).toMatchObject({ state: 'amended', locked: false })
  })
})

describe('a damaged history', () => {
  it('shows as broken and read-only, and nothing more is written to it', async () => {
    await vault.write('E.md', '# E\n', { author: 'alice' })
    await vault.write('E.md', '# E\n\nMore.\n', { author: 'alice' })
    const log = path.join(root, '.prem', 'history', 'E.md.jsonl')
    const text = await readFile(log, 'utf8')
    await writeFile(log, text.replace(/\}\n$/, '\n'))

    const fresh = new LocalFsProvider(root)
    try {
      expect(await fresh.recordStatus('E.md')).toMatchObject({ locked: true, chainOk: false })
      expect(await code(fresh.write('E.md', '# E\n\nChanged.\n', { author: 'alice' }))).toBe('LOCKED')
      expect(await readFile(path.join(root, 'E.md'), 'utf8')).toBe('# E\n\nMore.\n')
    } finally {
      await fresh.dispose()
    }
  })
})
