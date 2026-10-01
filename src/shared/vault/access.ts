import { VaultError } from './errors'
import { isInside, normalizeVaultPath } from './paths'
import type { VaultPath } from './types'

export type AccessLevel = 'none' | 'read' | 'write'

const RANK: Record<AccessLevel, number> = { none: 0, read: 1, write: 2 }

export function isAccessLevel(value: unknown): value is AccessLevel {
  return value === 'none' || value === 'read' || value === 'write'
}

/**
 * Per-folder permissions for one user, e.g. `{ "": "read", "Runbooks": "write" }`.
 * The rule for the deepest folder containing a path wins; paths no rule covers get no access.
 * Matching ignores case, because on a case-insensitive disk "finance/x.md" and "Finance/x.md" are the same file.
 */
export class Access {
  private readonly rules: { folder: VaultPath; level: AccessLevel }[]

  constructor(rules: Record<string, AccessLevel>) {
    this.rules = Object.entries(rules)
      .map(([folder, level]) => {
        if (!isAccessLevel(level)) throw new VaultError('INVALID_ARGUMENT', `Unknown access level "${level}"`)
        return { folder: normalizeVaultPath(folder).toLowerCase(), level }
      })
      .sort((a, b) => b.folder.length - a.folder.length)
  }

  levelFor(path: VaultPath): AccessLevel {
    const key = path.toLowerCase()
    return this.rules.find((r) => isInside(key, r.folder))?.level ?? 'none'
  }

  canRead(path: VaultPath): boolean {
    return RANK[this.levelFor(path)] >= RANK.read
  }

  canWrite(path: VaultPath): boolean {
    return this.levelFor(path) === 'write'
  }

  /** A folder is visible if it's readable itself or leads to a readable folder, so users can navigate to it. */
  canSee(path: VaultPath, kind: 'file' | 'folder'): boolean {
    if (this.canRead(path)) return true
    const key = path.toLowerCase()
    return kind === 'folder' && this.rules.some((r) => r.level !== 'none' && isInside(r.folder, key))
  }

  /** Moving or deleting a folder touches everything inside it, so every rule below it must allow writes too. */
  canWriteTree(path: VaultPath): boolean {
    const key = path.toLowerCase()
    return this.canWrite(path) && this.rules.every((r) => !isInside(r.folder, key) || r.level === 'write')
  }
}
