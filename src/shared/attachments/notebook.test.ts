import { describe, expect, it } from 'vitest'
import { imageDataUrl, MAX_TEXT_OUTPUT, parseNotebook, stripAnsi } from './notebook'

const nb = (cells: unknown[], metadata: unknown = { kernelspec: { display_name: 'Python 3 (ipykernel)' } }): string =>
  JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata, cells })

describe('parseNotebook', () => {
  it('reads the kernel name and cells, joining line lists', () => {
    const parsed = parseNotebook(
      nb([
        { cell_type: 'markdown', source: ['# Growth curve\n', 'OD600 over time'] },
        { cell_type: 'code', execution_count: 3, source: 'import pandas as pd', outputs: [] },
        { cell_type: 'raw', source: 'raw text' }
      ])
    )
    expect(parsed.language).toBe('Python 3 (ipykernel)')
    expect(parsed.cells).toEqual([
      { type: 'markdown', source: '# Growth curve\nOD600 over time', executionCount: undefined, outputs: [] },
      { type: 'code', source: 'import pandas as pd', executionCount: 3, outputs: [] },
      { type: 'raw', source: 'raw text', executionCount: undefined, outputs: [] }
    ])
  })

  it('falls back to the language name when there is no kernelspec', () => {
    expect(parseNotebook(nb([], { language_info: { name: 'R' } })).language).toBe('R')
  })

  it('reads stream, result, image, HTML and error outputs', () => {
    const [cell] = parseNotebook(
      nb([
        {
          cell_type: 'code',
          execution_count: 1,
          source: 'df',
          outputs: [
            { output_type: 'stream', name: 'stdout', text: ['loaded 96 wells\n'] },
            { output_type: 'stream', name: 'stderr', text: 'warning\n' },
            { output_type: 'execute_result', data: { 'text/plain': ['42'] } },
            { output_type: 'display_data', data: { 'image/png': 'iVBORw0K\nGgo=\n', 'text/plain': '<Figure>' } },
            { output_type: 'execute_result', data: { 'text/html': ['<table>', '</table>'], 'text/plain': 'df' } },
            {
              output_type: 'error',
              ename: 'ValueError',
              evalue: 'bad well',
              traceback: ['\u001b[0;31mValueError\u001b[0m', 'line 2']
            },
            { output_type: 'display_data', data: { 'application/vnd.jupyter.widget-view+json': {} } }
          ]
        }
      ])
    ).cells
    expect(cell.outputs).toEqual([
      { kind: 'text', text: 'loaded 96 wells\n', stream: 'stdout' },
      { kind: 'text', text: 'warning\n', stream: 'stderr' },
      { kind: 'text', text: '42' },
      { kind: 'image', mime: 'image/png', data: 'iVBORw0KGgo=' },
      { kind: 'html', html: '<table></table>', fallback: 'df' },
      { kind: 'error', name: 'ValueError', message: 'bad well', traceback: 'ValueError\nline 2' },
      { kind: 'unsupported', mime: 'application/vnd.jupyter.widget-view+json' }
    ])
  })

  it('cuts very long text output', () => {
    const [cell] = parseNotebook(
      nb([
        {
          cell_type: 'code',
          source: '',
          outputs: [{ output_type: 'stream', name: 'stdout', text: 'x'.repeat(MAX_TEXT_OUTPUT + 10) }]
        }
      ])
    ).cells
    const out = cell.outputs[0]
    expect(out.kind === 'text' && out.text.endsWith('(10 more characters not shown)')).toBe(true)
  })

  it('explains files it cannot show', () => {
    expect(() => parseNotebook('not json')).toThrow(/valid JSON/)
    expect(() => parseNotebook('{"worksheets": []}')).toThrow(/format 3/)
    expect(() => parseNotebook('{"hello": 1}')).toThrow(/Jupyter notebook/)
  })
})

describe('helpers', () => {
  it('strips terminal colour codes', () => {
    expect(stripAnsi('\u001b[1;32mok\u001b[0m')).toBe('ok')
  })

  it('makes image data URLs, with SVG as text', () => {
    expect(imageDataUrl({ kind: 'image', mime: 'image/png', data: 'AAA=' })).toBe('data:image/png;base64,AAA=')
    expect(imageDataUrl({ kind: 'image', mime: 'image/svg+xml', data: '<svg/>' })).toBe(
      'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E'
    )
  })
})
