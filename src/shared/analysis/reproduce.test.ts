import { describe, expect, it } from 'vitest'
import { outputFiles, parseMeta, renderOutput } from './cells'
import { changedInputs, compareOutput, describeChangedInputs, formatLock, lockFileName, parseLock } from './reproduce'
import type { CellResult } from './results'

const stamp = {
  requirementsHash: 'abc',
  tool: 'uv' as const,
  pythonVersion: '3.12.4',
  packages: 'numpy==2.1.0\npandas==2.2.3',
  id: '9b1e2c3d4f5a',
  created: '2026-10-03T10:00:00.000Z'
}

describe('environment lists', () => {
  it('saves the full package list with the Python version, and reads it back', () => {
    const text = formatLock(stamp)
    expect(lockFileName(stamp.id)).toBe('environment-9b1e2c3d4f5a.txt')
    expect(text).toContain('# python==3.12.4\n')
    expect(parseLock(text)).toEqual({ python: '3.12.4', requirements: 'numpy==2.1.0\npandas==2.2.3\n' })
  })

  it('reads a plain requirements file with no header', () => {
    expect(parseLock('numpy==2.1.0\n')).toEqual({ python: null, requirements: 'numpy==2.1.0\n' })
  })
})

const meta = parseMeta(
  'code=1f2e3d4c5b6a7980 ran=2026-10-02T14:05:31Z by=Cam took=1.2 python=3.12.4 env=9b1e2c3d4f5a inputs=N/attachments/plate.csv@a41c0e12f3b4,N/attachments/map.csv@0011223344aa'
)!

describe('changed inputs', () => {
  it('flags files that changed or are gone, and ignores ones not looked up', () => {
    const changed = changedInputs(meta, {
      'N/attachments/plate.csv': 'ffff' + 'a'.repeat(60),
      'N/attachments/map.csv': null
    })
    expect(changed).toEqual([
      { path: 'N/attachments/plate.csv', state: 'changed' },
      { path: 'N/attachments/map.csv', state: 'missing' }
    ])
    expect(describeChangedInputs(changed)).toBe(
      'plate.csv changed; map.csv is gone since this output. Run it again, or Reproduce to compare.'
    )
    expect(changedInputs(meta, { 'N/attachments/plate.csv': 'a41c0e12f3b4' + 'b'.repeat(52) })).toEqual([])
    expect(changedInputs(meta, {})).toEqual([])
  })
})

const png = btoa('\x89PNG figure bytes')
const result = (over: Partial<CellResult> = {}): CellResult => ({
  ok: true,
  outputs: [
    { kind: 'text', stream: 'stdout', text: 'mean 0.41\n' },
    { kind: 'image', mime: 'image/png', data: png }
  ],
  inputs: [{ path: 'N/attachments/plate.csv', sha256: 'a41c0e12f3b4' + 'c'.repeat(52) }],
  duration: 1,
  ranAt: '2026-10-02T14:05:31Z',
  pythonVersion: '3.12.4',
  environment: '9b1e2c3d4f5a',
  ...over
})

describe('compareOutput', () => {
  const hash = '1f2e3d4c5b6a7980'
  const original = result()
  const block = renderOutput(original, { ...meta, code: hash }, ['![x](attachments/analysis-1f2e3d4c-figure-1.png)'])
  const saved = new Map([['attachments/analysis-1f2e3d4c-figure-1.png', outputFiles(original.outputs, hash)[0].data]])
  const file = (url: string): Uint8Array | null => saved.get(url) ?? null

  it('finds a rerun with identical text and figure the same', () => {
    const c = compareOutput(block, meta, file, result(), hash)
    expect(c.verdict).toBe('same')
    expect(c.details).toEqual([
      { label: 'Printed text', same: true },
      { label: 'Figure 1', same: true }
    ])
    expect(c.inputs).toEqual([])
  })

  it('says which part differs', () => {
    const rerun = result({ outputs: [{ kind: 'text', stream: 'stdout', text: 'mean 0.42\n' }, original.outputs[1]] })
    const c = compareOutput(block, meta, file, rerun, hash)
    expect(c.verdict).toBe('different')
    expect(c.details).toEqual([
      { label: 'Printed text', same: false },
      { label: 'Figure 1', same: true }
    ])
  })

  it('notices a figure that changed, went missing, or a file that is gone', () => {
    const other = result({
      outputs: [original.outputs[0], { kind: 'image', mime: 'image/png', data: btoa('other') }]
    })
    expect(compareOutput(block, meta, file, other, hash).details[1]).toEqual({ label: 'Figure 1', same: false })
    const fewer = compareOutput(block, meta, file, result({ outputs: [original.outputs[0]] }), hash)
    expect(fewer.details[1]).toEqual({ label: 'Figure 1 (missing from the rerun)', same: false })
    const gone = compareOutput(block, meta, () => null, result(), hash)
    expect(gone.details[1]).toEqual({ label: 'Figure 1 (the saved file is gone)', same: false })
  })

  it('reports an error where the original worked, and inputs that differ', () => {
    const failed = result({
      ok: false,
      outputs: [{ kind: 'error', name: 'FileNotFoundError', message: 'plate.csv', traceback: 'Traceback…' }]
    })
    expect(compareOutput(block, meta, file, failed, hash).verdict).toBe('failed')
    const read = result({ inputs: [{ path: 'N/attachments/plate.csv', sha256: 'f'.repeat(64) }] })
    expect(compareOutput(block, meta, file, read, hash).inputs).toEqual(['N/attachments/plate.csv'])
  })
})
