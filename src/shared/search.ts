import { isInside, isMarkdown, noteTitle, TEMPLATES_FOLDER } from './paths'
import type { VaultPath } from './types'

export interface SearchMatch {
  /** 1-based line number. */
  line: number
  /** The line, shortened around the match if it's long. */
  text: string
  /** Where each term matched within `text`, as [start, end) pairs. */
  ranges: [number, number][]
  /** Offset of the first match in the note, to put the cursor there when it's opened. */
  offset: number
}

export interface SearchHit {
  path: VaultPath
  title: string
  titleRanges: [number, number][]
  matches: SearchMatch[]
  score: number
}

interface Doc {
  path: VaultPath
  title: string
  content: string
  /** Lowercased title, folders and content, searched together so every term can match anywhere. */
  haystack: string
  lower: string
}

const MAX_MATCH_LINES = 3
const SNIPPET = 160

/** Splits a query into lowercase terms. "Quoted phrases" stay together. */
export function parseQuery(query: string): string[] {
  const terms: string[] = []
  for (const m of query.matchAll(/"([^"]+)"|(\S+)/g)) {
    const term = (m[1] ?? m[2]).trim().toLowerCase()
    if (term) terms.push(term)
  }
  return [...new Set(terms)]
}

function rangesOf(lower: string, terms: string[]): [number, number][] {
  const ranges: [number, number][] = []
  for (const t of terms) {
    for (let i = lower.indexOf(t); i >= 0; i = lower.indexOf(t, i + t.length)) ranges.push([i, i + t.length])
  }
  return ranges.sort((a, b) => a[0] - b[0])
}

function countOf(lower: string, term: string, cap: number): number {
  let n = 0
  for (let i = lower.indexOf(term); i >= 0 && n < cap; i = lower.indexOf(term, i + term.length)) n++
  return n
}

function score(doc: Doc, terms: string[]): number {
  const title = doc.title.toLowerCase()
  let total = 0
  if (terms.every((t) => title.includes(t))) total += 100
  if (title.startsWith(terms[0])) total += 50
  if (title === terms.join(' ')) total += 100
  for (const t of terms) total += countOf(doc.lower, t, 20)
  return total
}

/**
 * Full-text search over the notes the user can read. It keeps each note's text in memory and scans it
 * per query, which stays well under the time of a keystroke for thousands of notes.
 */
export class SearchIndex {
  private docs = new Map<VaultPath, Doc>()

  build(files: { path: VaultPath; content: string }[]): void {
    this.docs.clear()
    for (const f of files) this.upsert(f.path, f.content)
  }

  upsert(path: VaultPath, content: string): void {
    if (!isMarkdown(path) || isInside(path, TEMPLATES_FOLDER)) return
    const title = noteTitle(path)
    const lower = content.toLowerCase()
    this.docs.set(path, { path, title, content, lower, haystack: `${title.toLowerCase()}\n${path.toLowerCase()}\n${lower}` })
  }

  remove(path: VaultPath): void {
    this.docs.delete(path)
  }

  removeFolder(folder: VaultPath): void {
    for (const p of [...this.docs.keys()]) if (isInside(p, folder)) this.docs.delete(p)
  }

  get size(): number {
    return this.docs.size
  }

  search(query: string, limit = 50): SearchHit[] {
    const terms = parseQuery(query)
    if (!terms.length) return []
    // Score every matching note cheaply, then build snippets only for the ones shown.
    const scored: { doc: Doc; score: number }[] = []
    for (const doc of this.docs.values()) {
      if (terms.every((t) => doc.haystack.includes(t))) scored.push({ doc, score: score(doc, terms) })
    }
    return scored
      .sort((a, b) => b.score - a.score || a.doc.title.localeCompare(b.doc.title))
      .slice(0, limit)
      .map(({ doc, score }) => this.hit(doc, terms, score))
  }

  private hit(doc: Doc, terms: string[], score: number): SearchHit {
    const titleRanges = rangesOf(doc.title.toLowerCase(), terms)

    const matches: SearchMatch[] = []
    const seenLines = new Set<number>()
    for (const t of terms) {
      const at = doc.lower.indexOf(t)
      if (at < 0) continue
      const lineStart = doc.lower.lastIndexOf('\n', at - 1) + 1
      if (seenLines.has(lineStart)) continue
      seenLines.add(lineStart)
      const lineEnd = doc.lower.indexOf('\n', at)
      const end = lineEnd < 0 ? doc.content.length : lineEnd
      // Show the part of a long line around the match.
      const from = Math.max(lineStart, Math.min(at - 40, end - SNIPPET))
      const to = Math.min(end, from + SNIPPET)
      const text = doc.content.slice(from, to)
      matches.push({
        line: doc.content.slice(0, lineStart).split('\n').length,
        text: (from > lineStart ? '…' : '') + text + (to < end ? '…' : ''),
        ranges: rangesOf(text.toLowerCase(), terms).map(([s, e]) => [s + (from > lineStart ? 1 : 0), e + (from > lineStart ? 1 : 0)]),
        offset: at
      })
      if (matches.length >= MAX_MATCH_LINES) break
    }
    matches.sort((a, b) => a.line - b.line)
    return { path: doc.path, title: doc.title, titleRanges, matches, score }
  }
}
