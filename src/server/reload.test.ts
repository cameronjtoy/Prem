import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { generateToken, hashToken, parseConfig, type UserConfig } from './config'
import { startServer, type PremServer } from './server'

const quiet = { info: () => {}, error: () => {} }
const tokens = { alice: generateToken(), bob: generateToken() }
const alice: UserConfig = { name: 'alice', tokenHash: hashToken(tokens.alice), access: { '': 'write' } }
const bob: UserConfig = { name: 'bob', tokenHash: hashToken(tokens.bob), access: { '': 'read' } }

let dir: string
let server: PremServer

const get = (route: string, token: string): Promise<Response> =>
  fetch(`${server.url}${route}`, { headers: { authorization: `Bearer ${token}` } })

/** Opens the live-update stream and resolves `closed` when the server ends it. */
async function openStream(token: string): Promise<{ closed: Promise<boolean> }> {
  const res = await get('/api/events', token)
  expect(res.status).toBe(200)
  const reader = res.body!.getReader()
  await reader.read() // ": connected"
  const closed = (async () => {
    for (;;) {
      const { done } = await reader.read().catch(() => ({ done: true }))
      if (done) return true
    }
  })()
  return { closed }
}

const within = <T>(promise: Promise<T>, ms: number): Promise<T | 'timeout'> =>
  Promise.race([promise, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'prem-reload-')))
  server = await startServer(parseConfig({ vault: '.', port: 0, users: [alice] }, dir), quiet)
})

afterEach(async () => {
  await server.close()
  await rm(dir, { recursive: true, force: true })
})

describe('updating people without a restart', () => {
  it('lets someone added to the config sign in straight away', async () => {
    expect((await get('/api/info', tokens.bob)).status).toBe(401)
    server.updateUsers([alice, bob])
    expect(await (await get('/api/info', tokens.bob)).json()).toMatchObject({ user: 'bob' })
  })

  it('locks out someone removed, and closes their live connection', async () => {
    server.updateUsers([alice, bob])
    const stream = await openStream(tokens.bob)
    server.updateUsers([alice])
    expect(await within(stream.closed, 2000)).toBe(true)
    expect((await get('/api/info', tokens.bob)).status).toBe(401)
  })

  it('applies new permissions and reconnects the people they affect', async () => {
    server.updateUsers([alice, bob])
    const bobStream = await openStream(tokens.bob)
    const aliceStream = await openStream(tokens.alice)
    server.updateUsers([alice, { ...bob, access: { '': 'read', Samples: 'write' } }])
    expect(await within(bobStream.closed, 2000)).toBe(true)
    expect(await within(aliceStream.closed, 300)).toBe('timeout')
    expect(await (await get('/api/info', tokens.bob)).json()).toMatchObject({ access: { Samples: 'write' } })
  })

  it('stops an old token working once it is replaced', async () => {
    const fresh = generateToken()
    const stream = await openStream(tokens.alice)
    server.updateUsers([{ ...alice, tokenHash: hashToken(fresh) }])
    expect(await within(stream.closed, 2000)).toBe(true)
    expect((await get('/api/info', tokens.alice)).status).toBe(401)
    expect((await get('/api/info', fresh)).status).toBe(200)
  })
})
