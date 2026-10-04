import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backupVault } from './backup'

function python(): string | null {
  for (const candidate of ['python3', 'python']) {
    try {
      execFileSync(candidate, ['-c', 'import zipfile'], { stdio: 'ignore' })
      return candidate
    } catch {
      // try the next one
    }
  }
  return null
}

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'prem-backup-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

// The zip is checked with Python's zipfile, an independent reader, so it's a real, standard zip.
describe.skipIf(!python())('backupVault', () => {
  it('zips every note, attachment and the history, and any zip reader can open it', async () => {
    const vault = path.join(dir, 'vault')
    await mkdir(path.join(vault, 'Notebook/2026/attachments'), { recursive: true })
    await mkdir(path.join(vault, '.prem/history/Notebook/2026'), { recursive: true })
    await writeFile(path.join(vault, 'Notebook/2026/Ligation — café.md'), '# Ligation\n'.repeat(200))
    await writeFile(path.join(vault, 'Notebook/2026/attachments/gel.png'), Buffer.from([137, 80, 78, 71, 1, 2, 3]))
    await writeFile(path.join(vault, '.prem/history/Notebook/2026/Ligation — café.md.jsonl'), '{"n":1}\n')
    await writeFile(path.join(vault, '.DS_Store'), 'x')
    const file = path.join(dir, 'backup.zip')

    const done: number[] = []
    const result = await backupVault(vault, file, (n) => done.push(n))
    expect(result.files).toBe(3)
    expect(done).toEqual([1, 2, 3])

    const listing = execFileSync(python()!, [
      '-c',
      'import sys, zipfile, json; z = zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; print(json.dumps({i.filename: z.read(i).decode("latin-1") for i in z.infolist()}))',
      file
    ]).toString()
    const files = JSON.parse(listing) as Record<string, string>
    expect(Object.keys(files).sort()).toEqual([
      '.prem/history/Notebook/2026/Ligation — café.md.jsonl',
      'Notebook/2026/Ligation — café.md',
      'Notebook/2026/attachments/gel.png'
    ])
    expect(files['.prem/history/Notebook/2026/Ligation — café.md.jsonl']).toBe('{"n":1}\n')
    expect((await readFile(file)).length).toBe(result.bytes)
  })

  it('leaves no half-written file when it fails', async () => {
    const file = path.join(dir, 'backup.zip')
    await expect(backupVault(path.join(dir, 'missing'), file)).rejects.toThrow()
    await expect(readFile(file)).rejects.toThrow()
  })
})
