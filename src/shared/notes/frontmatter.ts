/** A leading `---` block of flat `key: value` lines. Nested YAML isn't needed for notebook metadata. */
export interface Frontmatter {
  fields: Record<string, string>
  /** Offset just past the closing `---` line, or 0 if there's no frontmatter. */
  end: number
}

const OPEN = /^---\r?\n/
const CLOSE = /^(---|\.\.\.)[ \t]*$/m

export function parseFrontmatter(text: string): Frontmatter {
  if (!OPEN.test(text)) return { fields: {}, end: 0 }
  const bodyStart = text.indexOf('\n') + 1
  const close = CLOSE.exec(text.slice(bodyStart))
  if (!close) return { fields: {}, end: 0 }
  const block = text.slice(bodyStart, bodyStart + close.index)
  const fields: Record<string, string> = {}
  for (const line of block.split(/\r?\n/)) {
    const m = /^([A-Za-z0-9_-]+):[ \t]*(.*?)[ \t]*$/.exec(line)
    if (m) fields[m[1]] = unquote(m[2])
  }
  const lineEnd = text.indexOf('\n', bodyStart + close.index)
  return { fields, end: lineEnd < 0 ? text.length : lineEnd + 1 }
}

function unquote(value: string): string {
  const m = /^"(.*)"$/.exec(value) ?? /^'(.*)'$/.exec(value)
  return m ? m[1] : value
}

/** Sets one field, keeping every other line of the frontmatter as it was. Adds a frontmatter block if there isn't one. */
export function setFrontmatterField(text: string, key: string, value: string): string {
  const { end } = parseFrontmatter(text)
  if (!end) return `---\n${key}: ${value}\n---\n\n${text}`
  const block = text.slice(0, end)
  const line = new RegExp(`^${key}:.*$`, 'm')
  const next = line.test(block)
    ? block.replace(line, `${key}: ${value}`)
    : block.replace(/\n(---|\.\.\.)[ \t]*(\r?\n|$)/, `\n${key}: ${value}\n$1$2`)
  return next + text.slice(end)
}
