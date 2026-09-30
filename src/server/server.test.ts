import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isVaultError } from '@shared/errors'
import type { VaultChange } from '@shared/types'
import { normalizeServerUrl, RemoteProvider } from '../main/vault/RemoteProvider'
import { generateToken, hashToken, parseConfig, UserDirectory } from './config'
import { startServer, type PremServer } from './server'

const tokens = { alice: generateToken(), bob: generateToken(), bot: generateToken() }
const quiet = { info: () => {}, error: () => {} }

let base: string
let server: PremServer

async function expectCode(pending: Promise<unknown>, code: string): Promise<void> {
  const err = await pending.then(
    () => null,
    (e: unknown) => e
  )
  expect(isVaultError(err) ? err.code : err).toBe(code)
}

/** Resolves with the first change the provider reports for `path`, ignoring late events from earlier tests. */
function nextChange(provider: RemoteProvider, path: string): Promise<VaultChange> {
  return new Promise((resolve) => {
    const stop = provider.watch((changes) => {
      const match = changes.find((c) => c.path === path)
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
    expect(() => parseConfig({ vault: '.', users: [{ name: 'x', tokenHash: 'abc', access: {} }] }, base)).toThrow(/tokenHash/)
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
    expect(await alice.exists('templates/Runbook.md')).toBe(true)
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
