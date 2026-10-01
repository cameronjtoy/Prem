import type { ParsedLink } from '../vault/types'

const blank = (s: string): string => s.replace(/[^\n]/g, ' ')

/**
 * Replaces code blocks, inline code and math with spaces so that links inside them are ignored.
 * Newlines and lengths are preserved, so offsets into the result match the original text.
 */
export function maskNonLinkText(md: string): string {
  let fence: string | null = null
  const lines = md.split('\n').map((line) => {
    const m = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null
      return blank(line)
    }
    if (m) {
      fence = m[1]
      return blank(line)
    }
    return line
  })
  return lines
    .join('\n')
    .replace(/`[^`\n]+`/g, blank)
    .replace(/\$\$[\s\S]*?\$\$/g, blank)
    .replace(/\$(?!\s)[^$\n]+?(?<!\s)\$/g, blank)
}

const WIKILINK_RE = /(!?)\[\[([^[\]|#\n]+)(?:#([^[\]|\n]*))?(?:\|([^[\]\n]*))?\]\]/g

export function parseWikilinks(md: string): ParsedLink[] {
  const masked = maskNonLinkText(md)
  const links: ParsedLink[] = []
  let line = 0
  let lastIndex = 0
  for (const m of masked.matchAll(WIKILINK_RE)) {
    const target = m[2].trim()
    if (!target) continue
    for (let i = lastIndex; i < m.index; i++) if (masked.charCodeAt(i) === 10) line++
    lastIndex = m.index
    links.push({
      target,
      heading: m[3]?.trim() || undefined,
      alias: m[4]?.trim() || undefined,
      embed: m[1] === '!',
      from: m.index,
      to: m.index + m[0].length,
      line
    })
  }
  return links
}

/** Splits the inside of a [[...]] link, e.g. "Note#Heading|Alias". */
export function splitLinkText(inner: string): { target: string; heading?: string; alias?: string } {
  const [left, ...aliasParts] = inner.split('|')
  const [target, ...headingParts] = left.split('#')
  const alias = aliasParts.join('|').trim()
  const heading = headingParts.join('#').trim()
  return {
    target: target.trim(),
    heading: heading || undefined,
    alias: alias || undefined
  }
}
