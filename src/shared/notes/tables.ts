// Markdown tables and `## Heading` sections, for records that keep structured data in their body
// (a workflow's stages, a job's stage log) so it stays readable in any markdown viewer.

/** Where a `## Heading` section's content is: from just after the heading line to the next `## ` heading or the end. */
export function findSection(text: string, heading: string): { from: number; to: number } | null {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(`^## ${escaped}[ \\t]*$`, 'mi').exec(text)
  if (!m) return null
  const from = Math.min(text.length, m.index + m[0].length + 1)
  const next = /^## /m.exec(text.slice(from))
  return { from, to: next ? from + next.index : text.length }
}

export interface Table {
  header: string[]
  rows: string[][]
  /** Offsets of the table's lines in the text it was parsed from, `to` just past the last line's newline. */
  from: number
  to: number
}

const ROW = /^\s*\|.*\|\s*$/
const SEPARATOR = /^\s*\|(\s*:?-+:?\s*\|)+\s*$/

/** The cells of one `| a | b |` row. Pipes inside `[[link|alias]]` or escaped as `\|` don't split cells. */
export function splitRow(line: string): string[] {
  const inner = line.trim().replace(/^\|/, '').replace(/\|$/, '')
  const cells: string[] = []
  let cell = ''
  let depth = 0
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]
    if (c === '\\' && inner[i + 1] === '|') {
      cell += '|'
      i++
    } else if (c === '[' && inner[i + 1] === '[') {
      depth++
      cell += '[['
      i++
    } else if (c === ']' && inner[i + 1] === ']' && depth > 0) {
      depth--
      cell += ']]'
      i++
    } else if (c === '|' && depth === 0) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += c
    }
  }
  cells.push(cell.trim())
  return cells
}

/** The first table in `text` (from `offset`), with every row padded or cut to the header's width. */
export function parseTable(text: string, offset = 0): Table | null {
  const lines = text.slice(offset).split('\n')
  let pos = offset
  for (let i = 0; i < lines.length - 1; i++) {
    if (ROW.test(lines[i]) && SEPARATOR.test(lines[i + 1])) {
      const header = splitRow(lines[i])
      const from = pos
      let to = pos + lines[i].length + 1 + lines[i + 1].length + 1
      const rows: string[][] = []
      for (let j = i + 2; j < lines.length && ROW.test(lines[j]); j++) {
        const cells = splitRow(lines[j])
        rows.push(header.map((_, k) => cells[k] ?? ''))
        to += lines[j].length + 1
      }
      return { header, rows, from, to: Math.min(to, text.length) }
    }
    pos += lines[i].length + 1
  }
  return null
}

/** A cell's text made safe for a table: pipes outside links are escaped and line breaks become spaces. */
export function escapeCell(value: string): string {
  return value
    .replace(/\r?\n/g, ' ')
    .split(/(\[\[[^\]]*\]\])/)
    .map((part, i) => (i % 2 ? part : part.replace(/(?<!\\)\|/g, '\\|')))
    .join('')
    .trim()
}

const tableLine = (cells: string[]): string => `| ${cells.map((c) => escapeCell(c) || ' ').join(' | ')} |`

/** A table as markdown, ending with a newline. Empty cells are written as a single space. */
export function formatTable(header: string[], rows: string[][]): string {
  return [tableLine(header), `| ${header.map(() => '---').join(' | ')} |`, ...rows.map(tableLine)].join('\n') + '\n'
}

/** The index of a column by its header name, ignoring case, or -1. */
export function column(table: Pick<Table, 'header'>, name: string): number {
  return table.header.findIndex((h) => h.toLowerCase() === name.toLowerCase())
}

/** The first table inside a `## Heading` section, with where the section is. */
export function sectionTable(
  text: string,
  heading: string
): { section: { from: number; to: number }; table: Table } | null {
  const section = findSection(text, heading)
  if (!section) return null
  const table = parseTable(text.slice(0, section.to), section.from)
  return table ? { section, table } : null
}
