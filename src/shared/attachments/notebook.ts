// Reading Jupyter notebooks (.ipynb, nbformat 4) for a read-only preview.
//
// The preview shows what was saved in the file: markdown, code and the outputs from the last run. Nothing
// is executed. Outputs are reduced to the few kinds Prem can show safely: text, errors, images and HTML
// (which the renderer sanitizes before display).

export type NotebookOutput =
  | { kind: 'text'; text: string; stream?: 'stdout' | 'stderr' }
  | { kind: 'error'; name: string; message: string; traceback: string }
  | { kind: 'image'; mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/svg+xml'; data: string }
  | { kind: 'html'; html: string; fallback: string }
  | { kind: 'unsupported'; mime: string }

export interface NotebookCell {
  type: 'markdown' | 'code' | 'raw'
  source: string
  /** The `In [n]` number for code cells that were run. */
  executionCount?: number
  outputs: NotebookOutput[]
}

export interface Notebook {
  /** Kernel or language name, e.g. "Python 3". */
  language: string
  cells: NotebookCell[]
}

/** Text outputs longer than this are cut, so one runaway print loop doesn't swamp the note. */
export const MAX_TEXT_OUTPUT = 20_000

const IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/svg+xml'] as const

type Json = Record<string, unknown>

/** nbformat stores multi-line strings either as a string or as a list of lines. */
function text(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.filter((v) => typeof v === 'string').join('')
  return ''
}

const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*[A-Za-z]', 'g')

/** Tracebacks are coloured with terminal escape codes; the preview shows them as plain text. */
export function stripAnsi(value: string): string {
  return value.replace(ANSI, '')
}

function truncate(value: string): string {
  return value.length > MAX_TEXT_OUTPUT
    ? `${value.slice(0, MAX_TEXT_OUTPUT)}\n… (${value.length - MAX_TEXT_OUTPUT} more characters not shown)`
    : value
}

function parseOutput(raw: Json): NotebookOutput {
  switch (raw.output_type) {
    case 'stream':
      return {
        kind: 'text',
        text: truncate(stripAnsi(text(raw.text))),
        stream: raw.name === 'stderr' ? 'stderr' : 'stdout'
      }
    case 'error':
      return {
        kind: 'error',
        name: String(raw.ename ?? 'Error'),
        message: String(raw.evalue ?? ''),
        traceback: truncate(stripAnsi(text(Array.isArray(raw.traceback) ? raw.traceback.join('\n') : '')))
      }
    case 'execute_result':
    case 'display_data': {
      const data = (raw.data ?? {}) as Json
      for (const mime of IMAGE_MIMES) {
        if (data[mime] !== undefined) {
          const value = text(data[mime])
          return { kind: 'image', mime, data: mime === 'image/svg+xml' ? value : value.replace(/\s/g, '') }
        }
      }
      if (data['text/html'] !== undefined) {
        return { kind: 'html', html: text(data['text/html']), fallback: truncate(text(data['text/plain'])) }
      }
      if (data['text/markdown'] !== undefined) return { kind: 'text', text: truncate(text(data['text/markdown'])) }
      if (data['text/plain'] !== undefined) return { kind: 'text', text: truncate(stripAnsi(text(data['text/plain']))) }
      return { kind: 'unsupported', mime: Object.keys(data)[0] ?? 'unknown' }
    }
    default:
      return { kind: 'unsupported', mime: String(raw.output_type ?? 'unknown') }
  }
}

/** Parses an .ipynb file. Throws with a readable message if it isn't a notebook Prem can show. */
export function parseNotebook(json: string): Notebook {
  let raw: Json
  try {
    raw = JSON.parse(json) as Json
  } catch {
    throw new Error("This file isn't valid JSON, so it can't be shown as a notebook")
  }
  if (typeof raw !== 'object' || raw === null || !Array.isArray(raw.cells)) {
    throw new Error(
      raw && typeof raw === 'object' && 'worksheets' in raw
        ? 'This notebook uses the old format 3; open and save it in Jupyter to update it'
        : "This file doesn't look like a Jupyter notebook"
    )
  }
  const metadata = (raw.metadata ?? {}) as Json
  const kernel = (metadata.kernelspec ?? {}) as Json
  const languageInfo = (metadata.language_info ?? {}) as Json
  const language = String(kernel.display_name ?? languageInfo.name ?? 'Unknown kernel')

  const cells = (raw.cells as Json[]).map((cell): NotebookCell => {
    const type = cell.cell_type === 'markdown' || cell.cell_type === 'raw' ? cell.cell_type : 'code'
    const outputs = type === 'code' && Array.isArray(cell.outputs) ? (cell.outputs as Json[]).map(parseOutput) : []
    const count = cell.execution_count
    return {
      type,
      source: text(cell.source),
      executionCount: typeof count === 'number' ? count : undefined,
      outputs
    }
  })
  return { language, cells }
}

/** A data: URL for an image output, for use as an <img> source (where SVG scripts can't run). */
export function imageDataUrl(output: Extract<NotebookOutput, { kind: 'image' }>): string {
  return output.mime === 'image/svg+xml'
    ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(output.data)}`
    : `data:${output.mime};base64,${output.data}`
}
