/**
 * Turns one line of markdown into readable text for a backlink snippet: list markers, checkboxes,
 * headings, emphasis, code ticks, links and images become plain text. [[Wikilinks]] are kept so the
 * panel can highlight them.
 */
export function plainSnippet(line: string): string {
  const links: string[] = []
  let text = line
    // Protect wikilinks from the emphasis rules (names can contain _ or *).
    .replace(/!?\[\[[^[\]\n]+\]\]/g, (m) => `\uE000${links.push(m.replace(/^!/, '')) - 1}\uE000`)
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/^\s{0,3}#{1,6}\s+/, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
    .replace(/^\[[ xX]\]\s+/, '')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g, '$2')
    .replace(/(?<![\w*])([*_])(?=\S)(.+?)(?<=\S)\1(?![\w*])/g, '$2')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  text = text.replace(/\uE000(\d+)\uE000/g, (_, i: string) => links[Number(i)])
  return text
}
