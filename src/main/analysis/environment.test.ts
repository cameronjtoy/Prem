import { execFileSync } from 'node:child_process'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { currentStamp, ensureEnvironment, sha256 } from './environment'

/** A Python that can build environments: `python3` on macOS and Linux, often just `python` on Windows. */
function python(): string | null {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['-c', 'import venv, ensurepip'], { stdio: 'ignore' })
      return candidate
    } catch {
      // try the next one
    }
  }
  return null
}

// Builds a real environment, without installing anything, so it needs Python but not the network.
describe.skipIf(!python())('ensureEnvironment', () => {
  it('builds once, records what it built, and rebuilds when environment.txt changes', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'prem-env-')), 'vault1')
    const found = { python: python()!, version: null, uv: null, source: 'path' as const, problem: null }
    const progress: string[] = []
    const stamp = await ensureEnvironment({ dir, requirements: null }, found, (m) => progress.push(m))
    expect(stamp).toMatchObject({ tool: 'venv', requirementsHash: sha256('') })
    expect(stamp.pythonVersion).toMatch(/^3\.\d+/)
    expect(stamp.id).toMatch(/^[0-9a-f]{12}$/)
    expect(progress).toContain('Creating the environment')

    expect(await currentStamp({ dir, requirements: null }, process.platform === 'win32')).toEqual(stamp)
    expect(await currentStamp({ dir, requirements: 'numpy' }, process.platform === 'win32')).toBeNull()
    const again = await ensureEnvironment({ dir, requirements: null }, found, () => {})
    expect(again.created).toBe(stamp.created)
  }, 120_000)

  it('reports why it could not build, and leaves nothing half-made', async () => {
    const dir = path.join(await mkdtemp(path.join(tmpdir(), 'prem-env-')), 'vault2')
    const found = { python: python()!, version: null, uv: null, source: 'path' as const, problem: null }
    await expect(
      ensureEnvironment({ dir, requirements: './definitely-not-a-package-dir' }, found, () => {})
    ).rejects.toThrow(/definitely-not-a-package-dir|does not exist|not found|Invalid requirement/i)
    expect(
      await currentStamp({ dir, requirements: './definitely-not-a-package-dir' }, process.platform === 'win32')
    ).toBeNull()
  }, 120_000)
})
