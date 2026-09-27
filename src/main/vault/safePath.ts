import { realpath } from 'node:fs/promises'
import path from 'node:path'
import { VaultError } from '@shared/errors'
import { normalizeVaultPath } from '@shared/paths'

function isWithin(root: string, abs: string): boolean {
  const rel = path.relative(root, abs)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Maps a vault-relative path to an absolute one, rejecting anything that escapes the vault. */
export function resolveInsideVault(root: string, relPath: string): string {
  const abs = path.resolve(root, normalizeVaultPath(relPath))
  if (!isWithin(root, abs)) throw new VaultError('INVALID_PATH', `Path escapes the vault: ${relPath}`)
  return abs
}

/**
 * Checks that following symlinks doesn't leave the vault. `root` must already be a real path.
 * The nearest existing ancestor is checked, so this also works for paths about to be created.
 */
export async function assertRealPathInside(root: string, abs: string): Promise<void> {
  let current = abs
  for (;;) {
    try {
      const real = await realpath(current)
      if (!isWithin(root, real)) throw new VaultError('INVALID_PATH', 'Path resolves outside the vault')
      return
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      const parent = path.dirname(current)
      if (parent === current) return
      current = parent
    }
  }
}

export function toVaultPath(root: string, abs: string): string {
  return path.relative(root, abs).split(path.sep).join('/')
}
