// Keeping links working when notes and attachments move.
//
// After a rename or move, every note is passed through `relink`, which rewrites the links that pointed at
// something that moved: [[wikilinks]] to notes, and relative markdown links and embeds such as
// ![gel](attachments/gel.png). A note that moved itself also gets its relative links adjusted, so its
// images still show from the new folder. Links that still work are left exactly as written.
import { basename, dirname, normalizeVaultPath, stripMd } from '../vault/paths'
import type { VaultPath } from '../vault/types'
import type { Resolver } from './resolve'
import { maskNonLinkText, parseWikilinks } from './wikilinks'

/** Where each moved file went, keyed by its old path in lower case. */
export type Moves = Map<string, VaultPath>

/** Every file that moves when `from` is renamed to `to`, given the vault's files before the move. */
export function movesFor(from: VaultPath, to: VaultPath, files: Iterable<VaultPath>): Moves {
  const moves: Moves = new Map()
  const prefix = from.toLowerCase()
  for (const file of files) {
    const key = file.toLowerCase()
    if (key === prefix) moves.set(key, to)
    else if (key.startsWith(prefix + '/')) moves.set(key, to + file.slice(from.length))
  }
  return moves
}

/** The path `url` points to from a note in `noteDir`, or null for web links, anchors and paths outside the vault. */
export function resolveRelative(noteDir: VaultPath, url: string): VaultPath | null {
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#') || url.startsWith('/')) return null
  let decoded: string
  try {
    decoded = decodeURI(url.split('#')[0])
  } catch {
    return null
  }
  if (!decoded) return null
  const resolved: string[] = []
  for (const part of [...noteDir.split('/'), ...decoded.split('/')]) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!resolved.length) return null
      resolved.pop()
    } else resolved.push(part)
  }
  try {
    return normalizeVaultPath(resolved.join('/'))
  } catch {
    return null
  }
}

/** The relative link from a note in `fromDir` to `target`, written the way Prem writes attachment links. */
export function relativeUrl(fromDir: VaultPath, target: VaultPath): string {
  const from = fromDir ? fromDir.split('/') : []
  const to = target.split('/')
  let common = 0
  while (common < from.length && common < to.length - 1 && from[common] === to[common]) common++
  const rel = [...from.slice(common).map(() => '..'), ...to.slice(common)].join('/')
  return encodeURI(rel).replace(/\(/g, '%28').replace(/\)/g, '%29')
}

export interface RelinkContext {
  /** The note's path before the move (the same as `notePath` if it didn't move). */
  oldNotePath: VaultPath
  notePath: VaultPath
  moves: Moves
  /** Resolves wikilinks against the vault as it was before the move, and as it is after. */
  before: Resolver
  after: Resolver
  /** Lower-cased paths of every file before the move, so links to files that never existed are left alone. */
  existed: Set<string>
}

const MD_LINK_RE = /(!?)\[((?:[^[\]\n]|\[[^[\]\n]*\])*)\]\(\s*(<[^>\n]+>|[^)\s]+)(\s+"[^"\n]*")?\s*\)/g

/** Returns the note's text with links to moved files updated, or the same string if nothing needed to change. */
export function relink(content: string, ctx: RelinkContext): string {
  const edits: { from: number; to: number; text: string }[] = []
  const oldDir = dirname(ctx.oldNotePath)
  const newDir = dirname(ctx.notePath)

  for (const link of parseWikilinks(content)) {
    const target = ctx.before(link.target, ctx.oldNotePath)
    const moved = target && ctx.moves.get(target.toLowerCase())
    if (!moved) continue
    // Keep the style the link was written in: a bare name stays a name if it's still unambiguous.
    const name = stripMd(basename(moved))
    const text = !link.target.includes('/') && ctx.after(name, ctx.notePath) === moved ? name : stripMd(moved)
    if (text === link.target) continue
    const heading = link.heading ? `#${link.heading}` : ''
    const alias = link.alias ? `|${link.alias}` : ''
    edits.push({ from: link.from, to: link.to, text: `${link.embed ? '!' : ''}[[${text}${heading}${alias}]]` })
  }

  const masked = maskNonLinkText(content)
  for (const m of masked.matchAll(MD_LINK_RE)) {
    const raw = m[3]
    const url = raw.startsWith('<') ? raw.slice(1, -1) : raw
    const target = resolveRelative(oldDir, url)
    if (!target || !ctx.existed.has(target.toLowerCase())) continue
    const destination = ctx.moves.get(target.toLowerCase()) ?? target
    if (destination === target && oldDir === newDir) continue
    const hash = url.includes('#') ? url.slice(url.indexOf('#')) : ''
    const next = relativeUrl(newDir, destination) + hash
    if (next === url) continue
    const start = m.index + m[0].indexOf(raw, m[1].length + m[2].length + 2)
    edits.push({ from: start, to: start + raw.length, text: raw.startsWith('<') ? `<${next}>` : next })
  }

  if (!edits.length) return content
  edits.sort((a, b) => b.from - a.from)
  let out = content
  for (const e of edits) out = out.slice(0, e.from) + e.text + out.slice(e.to)
  return out
}
