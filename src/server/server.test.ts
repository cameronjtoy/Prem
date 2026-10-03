import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isVaultError } from '@shared/vault/errors'
import type { VaultChange } from '@shared/vault/types'
import { normalizeServerUrl, RemoteProvider } from '../main/vault/RemoteProvider'
import { generateToken, hashToken, parseConfig, UserDirectory } from './config'
import { startServer, type PremServer } from './server'

const tokens = { alice: generateToken(), bob: generateToken(), bot: generateToken() }
const logged: string[] = []
const quiet = { info: (m: string) => void logged.push(m), error: () => {} }

let base: string
let server: PremServer

async function expectCode(pending: Promise<unknown>, code: string): Promise<void> {
  const err = await pending.then(
    () => null,
    (e: unknown) => e
  )
  expect(isVaultError(err) ? err.code : err).toBe(code)
}

/** Resolves with the first change the provider reports for `notePath`, ignoring late events from earlier tests. */
function nextChange(provider: RemoteProvider, notePath: string): Promise<VaultChange> {
  return new Promise((resolve) => {
    const stop = provider.watch((changes) => {
      const match = changes.find((c) => c.path === notePath)
      if (!match) return
      stop()
      resolve(match)
    })
  })
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'prem-server-')))
  await mkdir(path.join(base, 'Runbooks'))
  await mkdir(path.join(base, 'Finance'))
  await writeFile(path.join(base, 'Welcome.md'), '# Welcome')
  await writeFile(path.join(base, 'Runbooks', 'Deploy.md'), '# Deploy')
  await writeFile(path.join(base, 'Finance', 'Pricing.md'), '# Pricing')
  const config = parseConfig(
    {
      vault: '.',
      port: 0,
      users: [
        { name: 'alice', tokenHash: hashToken(tokens.alice), access: { '': 'write' } },
        { name: 'bob', tokenHash: hashToken(tokens.bob), access: { '': 'read', Runbooks: 'write', Finance: 'none' } },
        { name: 'support-bot', tokenHash: hashToken(tokens.bot), access: { Runbooks: 'read' } }
      ]
    },
    base
  )
  server = await startServer(config, quiet)
})

afterAll(async () => {
  await server.close()
  await rm(base, { recursive: true, force: true })
})

describe('config', () => {
  it('rejects malformed configs', () => {
    expect(() => parseConfig({ vault: '.', users: [] }, base)).toThrow(/at least one user/)
    expect(() => parseConfig({ vault: '.', users: [{ name: 'x', tokenHash: 'abc', access: {} }] }, base)).toThrow(
      /tokenHash/
    )
    expect(() =>
      parseConfig({ vault: '.', users: [{ name: 'x', tokenHash: hashToken('t'), access: { '': 'admin' } }] }, base)
    ).toThrow(/access/)
  })

  it('matches tokens to users', () => {
    const dir = new UserDirectory([{ name: 'x', tokenHash: hashToken('secret'), access: { '': 'read' } }])
    expect(dir.authenticate('secret')?.name).toBe('x')
    expect(dir.authenticate('secreT')).toBeNull()
  })
})

describe('normalizeServerUrl', () => {
  it('requires https except on this machine', () => {
    expect(normalizeServerUrl('https://prem.example.com/')).toBe('https://prem.example.com')
    expect(normalizeServerUrl('http://localhost:4747')).toBe('http://localhost:4747')
    expect(() => normalizeServerUrl('http://prem.example.com')).toThrow(/https/)
    expect(() => normalizeServerUrl('not a url')).toThrow()
  })
})

describe('team server', () => {
  it('rejects unknown tokens', async () => {
    await expectCode(RemoteProvider.connect(server.url, 'prem_wrong'), 'UNAUTHORIZED')
    const res = await fetch(`${server.url}/api/entries`)
    expect(res.status).toBe(401)
  })

  it('logs repeated sign-ins with a wrong token, once', async () => {
    for (let i = 0; i < 12; i++) {
      const res = await fetch(`${server.url}/api/info`, { headers: { authorization: 'Bearer prem_guess' } })
      expect(res.status).toBe(401)
    }
    expect(logged.filter((m) => m.includes('invalid token'))).toEqual([
      expect.stringMatching(/^10 sign-ins with an invalid token from .+ in the last minute$/)
    ])
  })

  it('answers health checks without a token', async () => {
    const res = await fetch(`${server.url}/api/health`)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('reports who is connected', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    expect(bob.user).toBe('bob')
    expect(bob.name).toBe(path.basename(base))
  })

  it('seeds the default templates', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    expect(await alice.exists('templates/Experiment.md')).toBe(true)
    expect(await alice.exists('templates/Protocol.md')).toBe(true)
  })

  it('only lists and returns what a user can read', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const paths = (await bob.list()).map((e) => e.path)
    expect(paths).toContain('Runbooks/Deploy.md')
    expect(paths).not.toContain('Finance')
    expect(paths).not.toContain('Finance/Pricing.md')
    expect((await bob.readAllMarkdown()).map((f) => f.path)).not.toContain('Finance/Pricing.md')
    await expectCode(bob.read('Finance/Pricing.md'), 'FORBIDDEN')
    await expectCode(bob.read('finance/Pricing.md'), 'FORBIDDEN')
  })

  it('scopes a read-only bot to its folders', async () => {
    const bot = await RemoteProvider.connect(server.url, tokens.bot)
    expect((await bot.list()).map((e) => e.path).sort()).toEqual(['Runbooks', 'Runbooks/Deploy.md'])
    expect((await bot.read('Runbooks/Deploy.md')).content).toBe('# Deploy')
    await expectCode(bot.write('Runbooks/Deploy.md', 'hacked'), 'FORBIDDEN')
    await expectCode(bot.read('Welcome.md'), 'FORBIDDEN')
  })

  it('enforces write access per folder', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await bob.write('Runbooks/New.md', '# New', { createOnly: true })
    expect(await readFile(path.join(base, 'Runbooks', 'New.md'), 'utf8')).toBe('# New')
    await expectCode(bob.write('Welcome.md', 'edited'), 'FORBIDDEN')
    await expectCode(bob.rename('Runbooks/New.md', 'Moved.md'), 'FORBIDDEN')
    await expectCode(bob.remove('Welcome.md'), 'FORBIDDEN')
    await expectCode(bob.write('../escape.md', 'x'), 'INVALID_PATH')
  })

  it('rejects a save based on an outdated version', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const original = await alice.read('Runbooks/Deploy.md')
    const theirs = await bob.read('Runbooks/Deploy.md')
    await alice.write('Runbooks/Deploy.md', '# Deploy v2', { expectedVersion: original.version })
    await expectCode(bob.write('Runbooks/Deploy.md', '# Deploy (bob)', { expectedVersion: theirs.version }), 'CONFLICT')
    expect((await bob.read('Runbooks/Deploy.md')).content).toBe('# Deploy v2')
  })

  it('tells other clients about a save, but not the one that made it', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const aliceEvents: VaultChange[][] = []
    const stopAlice = alice.watch((c) => aliceEvents.push(c))
    const bobSees = nextChange(bob, 'Runbooks/Deploy.md')
    await new Promise((r) => setTimeout(r, 200))

    await alice.write('Runbooks/Deploy.md', '# Deploy v3')
    expect(await bobSees).toEqual({ type: 'modified', path: 'Runbooks/Deploy.md', kind: 'file' })
    await new Promise((r) => setTimeout(r, 300))
    expect(aliceEvents.flat().filter((c) => c.path === 'Runbooks/Deploy.md')).toEqual([])
    stopAlice()
  })

  it('moves deleted notes into the vault trash', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    await alice.write('Scratch.md', 'temp', { createOnly: true })
    await alice.remove('Scratch.md')
    expect(await alice.exists('Scratch.md')).toBe(false)
    expect((await alice.list()).some((e) => e.path.startsWith('.trash'))).toBe(false)
  })
})

describe('concurrent saves', () => {
  it('lets only one of two saves based on the same version win', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const { version } = await alice.read('Runbooks/Deploy.md')
    const results = await Promise.allSettled([
      alice.write('Runbooks/Deploy.md', '# from alice', { expectedVersion: version }),
      bob.write('Runbooks/Deploy.md', '# from bob!', { expectedVersion: version })
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    const rejected = results.find((r) => r.status === 'rejected') as PromiseRejectedResult
    expect(isVaultError(rejected.reason, 'CONFLICT')).toBe(true)
  })
})

describe('attachments', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])

  it('stores and returns files byte for byte', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await bob.writeBinary('Runbooks/attachments/gel.png', png, { createOnly: true })
    expect([...(await bob.readBinary('Runbooks/attachments/gel.png'))]).toEqual([...png])
    expect(await readFile(path.join(base, 'Runbooks', 'attachments', 'gel.png'))).toEqual(Buffer.from(png))
    await expectCode(bob.writeBinary('Runbooks/attachments/gel.png', png, { createOnly: true }), 'EXISTS')
  })

  it('lists attachments but keeps them out of the notes', async () => {
    const bot = await RemoteProvider.connect(server.url, tokens.bot)
    expect((await bot.list()).map((e) => e.path)).toContain('Runbooks/attachments/gel.png')
    expect((await bot.readAllMarkdown()).map((f) => f.path)).not.toContain('Runbooks/attachments/gel.png')
  })

  it('applies folder permissions to attachments', async () => {
    const bot = await RemoteProvider.connect(server.url, tokens.bot)
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await expectCode(bot.writeBinary('Runbooks/attachments/x.png', png), 'FORBIDDEN')
    await expectCode(bob.writeBinary('Welcome-attachments/x.png', png), 'FORBIDDEN')
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    await alice.writeBinary('Finance/attachments/secret.csv', new TextEncoder().encode('a,b'))
    await expectCode(bob.readBinary('Finance/attachments/secret.csv'), 'FORBIDDEN')
  })

  it("won't store a note as an attachment, or an oversized file", async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    await expectCode(alice.writeBinary('Sneaky.md', png), 'INVALID_PATH')
    const res = await fetch(`${server.url}/api/blob?path=big.bin`, {
      method: 'PUT',
      headers: { authorization: `Bearer ${tokens.alice}`, 'content-length': String(200 * 1024 * 1024) },
      body: 'x'
    }).catch(() => null)
    expect(res === null || res.status === 400).toBe(true)
  })

  it('tells other people when an attachment is added', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const bobSees = nextChange(bob, 'Runbooks/attachments/plate.csv')
    await new Promise((r) => setTimeout(r, 200))
    await alice.writeBinary('Runbooks/attachments/plate.csv', new TextEncoder().encode('well,od\nA1,0.5\n'))
    expect(await bobSees).toEqual({ type: 'created', path: 'Runbooks/attachments/plate.csv', kind: 'file' })
  })
})

describe('history on the team server', () => {
  it('records who saved each version from their token, not from the request', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await bob.write('Runbooks/History.md', 'one', { createOnly: true })
    await bob.write('Runbooks/History.md', 'two', { author: 'someone-else' } as never)
    const entries = await bob.history('Runbooks/History.md')
    expect(entries.map((e) => e.author)).toEqual(['bob', 'bob'])
    expect(await bob.readVersion('Runbooks/History.md', entries[0].id)).toBe('one')
  })

  it('only shows history to people who can read the note', async () => {
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await alice.write('Finance/Budget.md', 'secret', { createOnly: true })
    await expectCode(bob.history('Finance/Budget.md'), 'FORBIDDEN')
    const [first] = await alice.history('Finance/Budget.md')
    await expectCode(bob.readVersion('Finance/Budget.md', first.id), 'FORBIDDEN')
  })

  it('blocks hidden paths, so trash and history files are never served directly', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await expectCode(bob.read('.prem/history/Finance/Budget.md.jsonl'), 'INVALID_PATH')
    await expectCode(bob.readBinary('.trash/whatever'), 'INVALID_PATH')
    await expectCode(bob.readBinary('.prem/history/Finance/Budget.md.jsonl'), 'INVALID_PATH')
  })
})

describe('signing on the team server', () => {
  it('signs as the token holder, needs write access, and blocks edits from everyone after', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const alice = await RemoteProvider.connect(server.url, tokens.alice)
    const bot = await RemoteProvider.connect(server.url, tokens.bot)
    await bob.write('Runbooks/Signed run.md', 'OD600 0.51', { createOnly: true })
    await expectCode(bot.sign('Runbooks/Signed run.md', 'bob'), 'FORBIDDEN')
    const signed = await bob.sign('Runbooks/Signed run.md', 'pretending-to-be-alice', 'Checked')
    expect(signed.signature?.by).toBe('bob')
    await expectCode(bob.write('Runbooks/Signed run.md', 'OD600 0.99'), 'LOCKED')
    await expectCode(alice.write('Runbooks/Signed run.md', 'OD600 0.99'), 'LOCKED')
    await expectCode(alice.remove('Runbooks/Signed run.md'), 'LOCKED')
  })

  it('lets a reader witness, but not the signer', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    const bot = await RemoteProvider.connect(server.url, tokens.bot)
    await expectCode(bob.witness('Runbooks/Signed run.md', 'bob'), 'INVALID_ARGUMENT')
    const status = await bot.witness('Runbooks/Signed run.md', 'ignored')
    expect(status.witnesses.map((w) => w.by)).toEqual(['support-bot'])
  })

  it('accepts an amendment with a reason, attributed to the token holder', async () => {
    const bob = await RemoteProvider.connect(server.url, tokens.bob)
    await bob.write('Runbooks/Signed run.md', 'OD600 0.52', { amendReason: 'Re-read the plate' })
    const status = await bob.recordStatus('Runbooks/Signed run.md')
    expect(status).toMatchObject({ state: 'amended', locked: false })
    expect(status.amendment).toMatchObject({ by: 'bob', reason: 'Re-read the plate' })
  })
})
