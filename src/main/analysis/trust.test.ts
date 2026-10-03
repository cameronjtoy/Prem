import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { TrustStore, sha256 } from './trust'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'prem-trust-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('TrustStore', () => {
  it('remembers approved environments and code per vault, across restarts', async () => {
    const file = path.join(dir, 'analysis-trust.json')
    const store = new TrustStore(() => file)
    expect(await store.hasCode('v1', 'print(1)')).toBe(false)
    await store.approve('v1', { environment: sha256('numpy\n'), environmentText: 'numpy\n', code: ['print(1)\n'] })

    const again = new TrustStore(() => file)
    expect(await again.hasCode('v1', 'print(1)')).toBe(true)
    expect(await again.hasCode('v1', 'print(1)   \n')).toBe(true)
    expect(await again.hasCode('v1', 'print(2)')).toBe(false)
    expect(await again.hasCode('v2', 'print(1)')).toBe(false)
    expect(await again.hasEnvironment('v1', sha256('numpy\n'))).toBe(true)
    expect(await again.hasEnvironment('v2', sha256('numpy\n'))).toBe(false)
    expect(await again.lastEnvironment('v1')).toBe('numpy\n')
    // Only hashes are kept, never the code itself.
    expect(await readFile(file, 'utf8')).not.toContain('print(1)')
    // Readable only by you (Windows doesn't have these permission bits).
    expect(process.platform === 'win32' || ((await stat(file)).mode & 0o777) === 0o600).toBe(true)
  })

  it('starts empty when the file is missing or damaged', async () => {
    const store = new TrustStore(() => path.join(dir, 'nope', 'trust.json'))
    expect(await store.hasEnvironment('v', 'x')).toBe(false)
    await store.approve('v', { code: ['a = 1'] })
    expect(await store.hasCode('v', 'a = 1')).toBe(true)
  })
})
