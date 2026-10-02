// Analysis cells: ```python {run} blocks in a note, and the outputs Prem writes under them.
//
// Everything is plain markdown, so a note reads the same in any editor, prints to PDF, and is covered by
// history and signing like the rest of the note:
//
//   ```python {run}
//   df = pd.read_csv("attachments/plate.csv")
//   df.od.mean()
//   ```
//   <!-- prem:output code=1f2e3d4c5b6a7980 ran=2026-10-02T14:05:31Z by=Cam took=1.2 python=3.12.4 env=9b1e2c3d4f5a inputs=Notebook/2026/attachments/plate.csv@a41c0e12f3b4 -->
//   ```text
//   0.41
//   ```
//   ![Figure 1](attachments/analysis-1f2e3d4c-1.png)
//   <!-- /prem:output -->

import type { CellOutput, CellResult } from './results'

const OPEN = /^(`{3,})[ \t]*(?:python|py)[ \t]+\{[ \t]*run[ \t]*\}[ \t]*$/
// HTML also ends a comment at "--!>", so both are accepted.
const OUTPUT_START = /^<!--\s*prem:output\b(.*?)--!?>\s*$/
const OUTPUT_END = /^<!--\s*\/prem:output\s*--!?>\s*$/

export interface OutputMeta {
  /** codeHash() of the code that produced the output. */
  code: string
  ran: string
  by: string
  /** Seconds. */
  took: number
  python: string
  env: string | null
  inputs: { path: string; sha256: string }[]
  /** False when the cell raised an error or was stopped. */
  ok: boolean
}

export interface Cell {
  /** Offset of the opening fence line. */
  from: number
  /** Offset just after the closing fence line (or the end of the note, if it's never closed). */
  to: number
  /** The code between the fences. */
  code: string
  codeFrom: number
  codeTo: number
  output: { from: number; to: number; meta: OutputMeta | null } | null
}

/** A short fingerprint of a cell's code, to tell whether an output still matches the code above it. */
export function codeHash(code: string): string {
  const text = code.replace(/\s+$/, '')
  // Two 32-bit FNV-1a hashes with different seeds: fast, synchronous, and plenty to notice a change. The code
  // itself is in the note, and history keeps every version, so this doesn't need to be cryptographic.
  let a = 0x811c9dc5
  let b = 0x9747b28c
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    a = Math.imul(a ^ c, 0x01000193)
    b = Math.imul(b ^ c, 0x01000193)
  }
  return ((a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')).slice(0, 16)
}

/** Every run cell in a note, with the output block under it if there is one. */
export function findCells(text: string): Cell[] {
  const lines = text.split('\n')
  const starts: number[] = []
  let pos = 0
  for (const line of lines) {
    starts.push(pos)
    pos += line.length + 1
  }
  const lineEnd = (i: number): number => Math.min(starts[i] + lines[i].length + 1, text.length)

  const cells: Cell[] = []
  // Inside another fenced block, which may itself contain lines that look like a run cell.
  let fence: { char: string; length: number } | null = null
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (fence) {
      if (closesFence(line, fence.char, fence.length)) fence = null
      continue
    }
    const open = OPEN.exec(line)
    if (!open) {
      const other = /^(`{3,}|~{3,})/.exec(line)
      if (other) fence = { char: other[1][0], length: other[1].length }
      continue
    }
    const ticks = open[1].length
    let close = i + 1
    while (close < lines.length && !closesFence(lines[close], '`', ticks)) close++
    const codeFrom = i + 1 < lines.length ? starts[i + 1] : text.length
    const codeTo = close < lines.length ? starts[close] : text.length
    const cell: Cell = {
      from: starts[i],
      to: close < lines.length ? lineEnd(close) : text.length,
      code: text.slice(codeFrom, codeTo).replace(/\n$/, ''),
      codeFrom,
      codeTo,
      output: null
    }
    const next = close + 1
    const start = next < lines.length ? OUTPUT_START.exec(lines[next]) : null
    if (start) {
      let end = next + 1
      while (end < lines.length && !OUTPUT_END.test(lines[end])) end++
      if (end < lines.length) {
        cell.output = { from: starts[next], to: lineEnd(end), meta: parseMeta(start[1]) }
        i = end
        cells.push(cell)
        continue
      }
    }
    cells.push(cell)
    i = close
  }
  return cells
}

function closesFence(line: string, char: string, length: number): boolean {
  const m = /^(`{3,}|~{3,})\s*$/.exec(line)
  return !!m && m[1][0] === char && m[1].length >= length
}

const encode = (value: string): string =>
  encodeURIComponent(value).replace(/%2F/g, '/').replace(/%40/g, '@').replace(/%3A/g, ':')

function decode(v: string | undefined): string {
  try {
    return decodeURIComponent(v ?? '')
  } catch {
    return v ?? ''
  }
}

/** Reads the attributes of a `<!-- prem:output ... -->` line. Returns null if it isn't Prem's. */
export function parseMeta(attributes: string): OutputMeta | null {
  const fields = new Map<string, string>()
  for (const m of attributes.matchAll(/([a-z]+)=(\S*)/g)) fields.set(m[1], m[2])
  if (!fields.has('code')) return null
  const inputs = (fields.get('inputs') ?? '')
    .split(',')
    .filter(Boolean)
    .map((item) => {
      const at = item.lastIndexOf('@')
      return { path: decode(at > 0 ? item.slice(0, at) : item), sha256: at > 0 ? item.slice(at + 1) : '' }
    })
  return {
    code: fields.get('code')!,
    ran: decode(fields.get('ran')),
    by: decode(fields.get('by')),
    took: Number(fields.get('took')) || 0,
    python: decode(fields.get('python')),
    env: fields.get('env') && fields.get('env') !== '-' ? fields.get('env')! : null,
    inputs,
    ok: fields.get('ok') !== 'no'
  }
}

export function metaComment(meta: OutputMeta): string {
  const parts = [
    `code=${meta.code}`,
    `ran=${encode(meta.ran)}`,
    `by=${encode(meta.by || 'unknown')}`,
    `took=${meta.took}`,
    `python=${encode(meta.python)}`,
    `env=${meta.env ?? '-'}`
  ]
  if (!meta.ok) parts.push('ok=no')
  if (meta.inputs.length)
    parts.push(`inputs=${meta.inputs.map((i) => `${encode(i.path)}@${i.sha256.slice(0, 12)}`).join(',')}`)
  return `<!-- prem:output ${parts.join(' ')} -->`
}

/** A fence long enough that nothing in the text can close it early. */
function fenced(text: string, info: string): string {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const fence = '`'.repeat(longest + 1)
  return `${fence}${info}\n${text.replace(/\n+$/, '')}\n${fence}`
}

/** An attachment to store for an output: a figure or a table. */
export interface OutputFile {
  name: string
  data: Uint8Array
  /** Alt text for the link, e.g. "Figure 1" or "Table: 96 rows × 4 columns". */
  label: string
}

/** The files an output needs stored as attachments, in the order they appear. */
export function outputFiles(outputs: CellOutput[], hash: string): OutputFile[] {
  const files: OutputFile[] = []
  let figures = 0
  let tables = 0
  for (const o of outputs) {
    if (o.kind === 'image') {
      figures++
      files.push({
        name: `analysis-${hash.slice(0, 8)}-figure-${figures}.png`,
        data: base64Bytes(o.data),
        label: `Figure ${figures}`
      })
    } else if (o.kind === 'table') {
      tables++
      files.push({
        name: `analysis-${hash.slice(0, 8)}-table-${tables}.csv`,
        data: new TextEncoder().encode(o.csv),
        label: `Table: ${o.rows} ${o.rows === 1 ? 'row' : 'rows'} × ${o.columns} ${o.columns === 1 ? 'column' : 'columns'}${o.truncated ? ' (first 1,000 rows)' : ''}`
      })
    }
  }
  return files
}

function base64Bytes(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

/**
 * The output block for a run. `links` holds the markdown for each stored file from outputFiles(), in order,
 * e.g. "![plate.png](attachments/plate.png)"; its alt text is replaced by the file's label.
 */
export function renderOutput(result: CellResult, meta: Omit<OutputMeta, 'ok'>, links: string[]): string {
  const files = outputFiles(result.outputs, meta.code)
  const parts: string[] = [metaComment({ ...meta, ok: result.ok })]
  let file = 0
  for (const o of result.outputs) {
    switch (o.kind) {
      case 'text':
        parts.push(fenced(o.text, o.stream === 'stderr' ? 'text {stderr}' : 'text'))
        break
      case 'result':
        parts.push(fenced(o.text, 'text'))
        break
      case 'error':
        parts.push(fenced(o.traceback || `${o.name}: ${o.message}`, 'text {error}'))
        break
      case 'image':
      case 'table': {
        const link = links[file]
        const label = files[file]?.label ?? ''
        file++
        if (link) parts.push(link.replace(/^(!?)\[[^\]]*\]/, (_m, bang: string) => `${bang}[${label}]`))
        break
      }
    }
  }
  if (parts.length === 1) parts.push('_No output._')
  parts.push('<!-- /prem:output -->')
  return `${parts.join('\n')}\n`
}

/** The edit that puts `block` in place of a cell's output, or straight after the cell if it has none. */
export function outputChange(text: string, cell: Cell, block: string): { from: number; to: number; insert: string } {
  if (cell.output) return { from: cell.output.from, to: cell.output.to, insert: block }
  const at = cell.to
  return { from: at, to: at, insert: text.slice(0, at).endsWith('\n') ? block : `\n${block}` }
}

/** The note with a cell's output block replaced, or added straight after the cell. */
export function replaceOutput(text: string, cell: Cell, block: string): string {
  const { from, to, insert } = outputChange(text, cell, block)
  return text.slice(0, from) + insert + text.slice(to)
}

export type OutputPart =
  | { kind: 'text'; stream: 'stdout' | 'stderr' | 'error'; text: string }
  | { kind: 'file'; label: string; url: string; embed: boolean }
  | { kind: 'note'; text: string }

/** The pieces of an output block between its comments, for showing it in the editor. */
export function parseOutputBody(block: string): OutputPart[] {
  const lines = block.split('\n')
  const parts: OutputPart[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (OUTPUT_START.test(line) || OUTPUT_END.test(line) || !line.trim()) continue
    const fence = /^(`{3,})text(?:\s*\{(stderr|error)\})?\s*$/.exec(line)
    if (fence) {
      const body: string[] = []
      i++
      while (i < lines.length && !closesFence(lines[i], '`', fence[1].length)) body.push(lines[i++])
      parts.push({
        kind: 'text',
        stream: (fence[2] as 'stderr' | 'error' | undefined) ?? 'stdout',
        text: body.join('\n')
      })
      continue
    }
    const link = /^(!?)\[([^\]]*)\]\(([^)\s]+)\)\s*$/.exec(line)
    if (link) {
      parts.push({ kind: 'file', label: link[2], url: link[3], embed: link[1] === '!' })
      continue
    }
    parts.push({ kind: 'note', text: line.replace(/^_(.*)_$/, '$1') })
  }
  return parts
}

/** One line describing an output, e.g. "Ran 2 Oct 2026 14:05 by Cam · 1.2 s · Python 3.12.4 · environment 9b1e2c3d4f5a". */
export function describeMeta(meta: OutputMeta, formatTime: (iso: string) => string): string {
  const parts = [`Ran ${formatTime(meta.ran)}${meta.by ? ` by ${meta.by}` : ''}`]
  if (meta.took) parts.push(`${meta.took < 10 ? meta.took.toFixed(1) : Math.round(meta.took)} s`)
  if (meta.python) parts.push(`Python ${meta.python}`)
  if (meta.env) parts.push(`environment ${meta.env}`)
  if (meta.inputs.length)
    parts.push(`read ${meta.inputs.map((i) => i.path.slice(i.path.lastIndexOf('/') + 1)).join(', ')}`)
  return parts.join(' · ')
}
