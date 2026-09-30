/**
 * Parses CSV or TSV text into rows, handling quoted fields with embedded separators, quotes and
 * line breaks. Stops after `maxRows` rows so a huge instrument export can't freeze a preview.
 */
export function parseDelimited(text: string, separator: ',' | '\t', maxRows = Infinity): { rows: string[][]; truncated: boolean } {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0

  const endRow = (): boolean => {
    row.push(field)
    field = ''
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    return rows.length >= maxRows
  }

  for (; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (c === '"') quoted = false
      else field += c
    } else if (c === '"' && field === '') quoted = true
    else if (c === separator) {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      if (endRow()) return { rows, truncated: i < text.length - 1 }
    } else field += c
  }
  if (field !== '' || row.length) endRow()
  return { rows, truncated: false }
}
