import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PythonRunner } from './runner'

const SCRIPT = path.join(__dirname, 'prem_runner.py')

function pythonWith(module?: string): string | null {
  for (const python of ['python3', 'python']) {
    try {
      execFileSync(python, ['-c', module ? `import ${module}` : 'import sys'], { stdio: 'ignore' })
      return python
    } catch {
      // try the next one
    }
  }
  return null
}

const python = pythonWith()
const runners: PythonRunner[] = []
const runner = (): PythonRunner => {
  const r = new PythonRunner(python!, SCRIPT)
  runners.push(r)
  return r
}
afterEach(() => runners.splice(0).forEach((r) => r.kill()))

// CI installs Python; on a computer without it these are skipped rather than failed.
describe.skipIf(!python)('PythonRunner', () => {
  it('runs cells in order, sharing variables, and shows the last value', async () => {
    const r = runner()
    const dir = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    expect(await r.run('x = 20\nprint("half", x // 2)', dir, dir, 10_000)).toMatchObject({
      ok: true,
      outputs: [{ kind: 'text', stream: 'stdout', text: 'half 10\n' }]
    })
    expect((await r.run('x + 1', dir, dir, 10_000)).outputs).toEqual([{ kind: 'result', text: '21' }])
  })

  it('reports errors with the cell’s own lines, and keeps going', async () => {
    const r = runner()
    const dir = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    const failed = await r.run('def f():\n    return 1 / 0\nf()', dir, dir, 10_000)
    expect(failed.ok).toBe(false)
    expect(failed.outputs[0]).toMatchObject({ kind: 'error', name: 'ZeroDivisionError' })
    expect(failed.outputs[0]).toHaveProperty('traceback', expect.stringContaining('return 1 / 0'))
    expect(failed.outputs[0]).toHaveProperty('traceback', expect.not.stringContaining('prem_runner'))
    expect((await r.run('"still here"', dir, dir, 10_000)).ok).toBe(true)
  })

  it('records the files a cell reads, with their sha256', async () => {
    const r = runner()
    const root = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    await writeFile(path.join(root, 'plate.csv'), 'well,od\nA1,0.41\n')
    const result = await r.run('open("plate.csv").read().count("\\n")', root, root, 10_000)
    expect(result.outputs).toEqual([{ kind: 'result', text: '2' }])
    const sha = createHash('sha256').update('well,od\nA1,0.41\n').digest('hex')
    expect(result.inputs).toEqual([{ path: 'plate.csv', sha256: sha }])
  })

  // On macOS the temp folder (/var) is a symlink to /private/var, and synced folders can be too: Python sees
  // the real path, Prem the linked one. Files read must still count as inside the vault.
  it.skipIf(process.platform === 'win32')('records inputs when the vault is reached through a symlink', async () => {
    const r = runner()
    const real = await mkdtemp(path.join(tmpdir(), 'prem-real-'))
    const linked = path.join(await mkdtemp(path.join(tmpdir(), 'prem-link-')), 'vault')
    await symlink(real, linked)
    await writeFile(path.join(real, 'plate.csv'), 'well,od\n')
    const result = await r.run('open("plate.csv").read()', linked, linked, 10_000)
    expect(result.inputs.map((i) => i.path)).toEqual(['plate.csv'])
  })

  it('stops a cell that runs too long and starts afresh', async () => {
    const r = runner()
    const dir = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    await r.run('kept = 1', dir, dir, 10_000)
    await expect(r.run('import time\ntime.sleep(30)', dir, dir, 500)).rejects.toThrow(/Stopped after/)
    const after = await r.run('"kept" in globals()', dir, dir, 10_000)
    expect(after.outputs).toEqual([{ kind: 'result', text: 'False' }])
  })

  it.skipIf(process.platform === 'win32')('Stop interrupts a cell but keeps the variables', async () => {
    const r = runner()
    const dir = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    await r.run('kept = 1', dir, dir, 10_000)
    const slow = r.run('import time\ntime.sleep(30)', dir, dir, 20_000)
    await new Promise((resolve) => setTimeout(resolve, 300))
    r.interrupt()
    expect((await slow).outputs[0]).toMatchObject({ kind: 'error', name: 'Stopped' })
    expect((await r.run('kept', dir, dir, 10_000)).outputs).toEqual([{ kind: 'result', text: '1' }])
  })
})

describe.skipIf(!pythonWith('pandas'))('PythonRunner with pandas', () => {
  it('returns a DataFrame as a table', async () => {
    const r = runner()
    const dir = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    const result = await r.run('import pandas as pd\npd.DataFrame({"a": [1, 2], "b": [3, 4]})', dir, dir, 30_000)
    expect(result.outputs).toEqual([
      { kind: 'table', csv: ',a,b\n0,1,3\n1,2,4\n', rows: 2, columns: 2, truncated: false }
    ])
  })
})

describe.skipIf(!pythonWith('matplotlib'))('PythonRunner with matplotlib', () => {
  it('saves each figure as a PNG', async () => {
    const r = runner()
    const dir = await mkdtemp(path.join(tmpdir(), 'prem-run-'))
    const result = await r.run('import matplotlib.pyplot as plt\nplt.plot([1, 2, 3])\nNone', dir, dir, 60_000)
    expect(result.outputs).toHaveLength(1)
    expect(result.outputs[0]).toMatchObject({ kind: 'image', mime: 'image/png' })
    const png = Buffer.from((result.outputs[0] as { data: string }).data, 'base64')
    expect(png.subarray(1, 4).toString()).toBe('PNG')
  })
})
