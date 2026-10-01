import { basename, dirname, isMarkdown, stripMd } from '../vault/paths'
import type { VaultPath } from '../vault/types'

export type Resolver = (target: string, fromPath?: VaultPath) => VaultPath | null

const key = (s: string): string => stripMd(s.trim()).toLowerCase()

/**
 * Resolves wikilink targets the way Obsidian does: by file name, case-insensitively.
 * When several notes share a name, the one in the linking note's folder wins, then the shortest path.
 * A target containing "/" is matched against the end of the note's path instead.
 */
export function createResolver(paths: Iterable<VaultPath>): Resolver {
  const byName = new Map<string, VaultPath[]>()
  const byPath = new Map<string, VaultPath>()
  for (const p of paths) {
    if (!isMarkdown(p)) continue
    byPath.set(key(p), p)
    const name = key(basename(p))
    const list = byName.get(name)
    if (list) list.push(p)
    else byName.set(name, [p])
  }

  return (target, fromPath) => {
    const k = key(target)
    if (!k) return null
    if (k.includes('/')) {
      const exact = byPath.get(k.replace(/^\/+/, ''))
      if (exact) return exact
      for (const [pk, p] of byPath) if (pk.endsWith('/' + k)) return p
      return null
    }
    const candidates = byName.get(k)
    if (!candidates) return null
    if (candidates.length === 1) return candidates[0]
    if (fromPath !== undefined) {
      const dir = dirname(fromPath)
      const sibling = candidates.find((c) => dirname(c) === dir)
      if (sibling) return sibling
    }
    return [...candidates].sort((a, b) => a.length - b.length || a.localeCompare(b))[0]
  }
}
