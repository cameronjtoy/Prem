import { describe, expect, it } from 'vitest'
import {
  codeHash,
  describeMeta,
  findCells,
  parseOutputBody,
  metaComment,
  outputFiles,
  parseMeta,
  renderOutput,
  replaceOutput
} from './cells'
import type { CellResult } from './results'

const NOTE = `# Plate read

\`\`\`python {run}
x = 1
x + 1
\`\`\`

Some text.

\`\`\`python
not run
\`\`\`
`

const result = (outputs: CellResult['outputs'], ok = true): CellResult => ({
  ok,
  outputs,
  inputs: [{ path: 'Notebook/2026/attachments/plate read.csv', sha256: 'a41c0e12f3b4' + '0'.repeat(52) }],
  duration: 1.234,
  ranAt: '2026-10-02T14:05:31Z',
  pythonVersion: '3.12.4',
  environment: '9b1e2c3d4f5a'
})

const meta = (code: string) => ({
  code: codeHash(code),
  ran: '2026-10-02T14:05:31Z',
  by: 'Cam Toy',
  took: 1.2,
  python: '3.12.4',
  env: '9b1e2c3d4f5a',
  inputs: [{ path: 'Notebook/2026/attachments/plate read.csv', sha256: 'a41c0e12f3b4' }]
})

describe('findCells', () => {
  it('finds python {run} blocks only', () => {
    const cells = findCells(NOTE)
    expect(cells).toHaveLength(1)
    expect(cells[0].code).toBe('x = 1\nx + 1')
    expect(NOTE.slice(cells[0].from, cells[0].to)).toBe('```python {run}\nx = 1\nx + 1\n```\n')
    expect(cells[0].output).toBeNull()
  })

  it('ignores run cells shown inside other code blocks', () => {
    const text = '````markdown\n```python {run}\nprint(1)\n```\n````\n'
    expect(findCells(text)).toEqual([])
  })

  it('handles a cell that is never closed', () => {
    const cells = findCells('```python {run}\nprint(1)')
    expect(cells[0].code).toBe('print(1)')
  })
})

describe('outputs', () => {
  it('writes an output block under the cell, then replaces it on the next run', () => {
    const [cell] = findCells(NOTE)
    const first = replaceOutput(NOTE, cell, renderOutput(result([{ kind: 'result', text: '2' }]), meta(cell.code), []))
    expect(first).toContain('```\n<!-- prem:output code=')
    expect(first).toContain('```text\n2\n```\n<!-- /prem:output -->\n\nSome text.')

    const [again] = findCells(first)
    expect(again.output?.meta).toMatchObject({
      code: codeHash(cell.code),
      by: 'Cam Toy',
      took: 1.2,
      env: '9b1e2c3d4f5a',
      inputs: [{ path: 'Notebook/2026/attachments/plate read.csv', sha256: 'a41c0e12f3b4' }],
      ok: true
    })
    const second = replaceOutput(
      first,
      again,
      renderOutput(result([{ kind: 'result', text: '3' }]), meta(cell.code), [])
    )
    expect(second.match(/prem:output code/g)).toHaveLength(1)
    expect(second).toContain('```text\n3\n```')
    expect(second).not.toContain('```text\n2\n```')
  })

  it('shows printed text, errors and stored figures and tables', () => {
    const outputs: CellResult['outputs'] = [
      { kind: 'text', stream: 'stdout', text: 'has ``` inside\n' },
      { kind: 'text', stream: 'stderr', text: 'warning\n' },
      { kind: 'image', mime: 'image/png', data: btoa('png') },
      { kind: 'table', csv: 'a\n1\n', rows: 1, columns: 1, truncated: false },
      { kind: 'error', name: 'ValueError', message: 'bad', traceback: 'Traceback…\nValueError: bad' }
    ]
    const files = outputFiles(outputs, 'abcdef0123456789')
    expect(files.map((f) => [f.name, f.label])).toEqual([
      ['analysis-abcdef01-figure-1.png', 'Figure 1'],
      ['analysis-abcdef01-table-1.csv', 'Table: 1 row × 1 column']
    ])
    expect(new TextDecoder().decode(files[0].data)).toBe('png')
    const block = renderOutput(result(outputs, false), meta('x'), [
      '![analysis-abcdef01-figure-1.png](attachments/analysis-abcdef01-figure-1.png)',
      '![analysis-abcdef01-table-1.csv](attachments/analysis-abcdef01-table-1.csv)'
    ])
    expect(block).toContain('````text\nhas ``` inside\n````')
    expect(block).toContain('```text {stderr}\nwarning\n```')
    expect(block).toContain('![Figure 1](attachments/analysis-abcdef01-figure-1.png)')
    expect(block).toContain('![Table: 1 row × 1 column](attachments/analysis-abcdef01-table-1.csv)')
    expect(block).toContain('```text {error}\nTraceback…\nValueError: bad\n```')
    expect(block).toContain(' ok=no ')
  })

  it('reads an output block back into its pieces', () => {
    const block = renderOutput(
      result([
        { kind: 'text', stream: 'stdout', text: 'hi\n' },
        { kind: 'image', mime: 'image/png', data: btoa('png') },
        { kind: 'error', name: 'E', message: 'm', traceback: 'Traceback\nE: m' }
      ]),
      meta('x'),
      ['![a.png](attachments/a.png)']
    )
    expect(parseOutputBody(block)).toEqual([
      { kind: 'text', stream: 'stdout', text: 'hi' },
      { kind: 'file', label: 'Figure 1', url: 'attachments/a.png', embed: true },
      { kind: 'text', stream: 'error', text: 'Traceback\nE: m' }
    ])
    expect(parseOutputBody(renderOutput(result([]), meta('x'), []))).toEqual([{ kind: 'note', text: 'No output.' }])
  })

  it('round-trips the record of a run', () => {
    const m = { ...meta('x'), ok: false, env: null }
    expect(parseMeta(metaComment(m).replace(/^<!-- prem:output|-->$/g, ''))).toEqual(m)
  })

  it('describes a run in one line', () => {
    expect(describeMeta({ ...meta('x'), ok: true }, () => '2 Oct 14:05')).toBe(
      'Ran 2 Oct 14:05 by Cam Toy · 1.2 s · Python 3.12.4 · environment 9b1e2c3d4f5a · read plate read.csv'
    )
  })

  it('notices when the code changes, but not trailing blank lines', () => {
    expect(codeHash('x = 1\n\n')).toBe(codeHash('x = 1'))
    expect(codeHash('x = 1')).not.toBe(codeHash('x = 2'))
    expect(codeHash('x')).toMatch(/^[0-9a-f]{16}$/)
  })
})
