import { mkdtemp, mkdir, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { assertRealPathInside, resolveInsideVault, toVaultPath } from './safePath'

let base: string
let root: string
let outside: string

beforeAll(async () => {
  base = await realpath(await mkdtemp(path.join(tmpdir(), 'vault-test-')))
  root = path.join(base, 'vault')
  outside = path.join(base, 'outside')
  await mkdir(root)
  await mkdir(outside)
  // A junction on Windows, where ordinary symlinks need admin rights; other systems ignore the type.
  await symlink(outside, path.join(root, 'escape'), 'junction')
})

afterAll(() => rm(base, { recursive: true, force: true }))

describe('resolveInsideVault', () => {
  it('resolves normal paths inside the vault', () => {
    expect(resolveInsideVault(root, 'a/b.md')).toBe(path.join(root, 'a', 'b.md'))
    expect(resolveInsideVault(root, '')).toBe(root)
  })

  it('rejects paths that leave the vault', () => {
    expect(() => resolveInsideVault(root, '../outside/x.md')).toThrow()
    expect(() => resolveInsideVault(root, path.join(outside, 'x.md'))).toThrow()
  })
})

describe('assertRealPathInside', () => {
  it('allows paths that do not exist yet', async () => {
    await expect(assertRealPathInside(root, path.join(root, 'new', 'note.md'))).resolves.toBeUndefined()
  })

  it('rejects paths that escape through a symlink', async () => {
    await expect(assertRealPathInside(root, path.join(root, 'escape', 'note.md'))).rejects.toThrow()
  })
})

describe('toVaultPath', () => {
  it('produces POSIX relative paths', () => {
    expect(toVaultPath(root, path.join(root, 'a', 'b.md'))).toBe('a/b.md')
  })
})
