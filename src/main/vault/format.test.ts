import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkVaultFormat, VAULT_FORMAT } from './format'

let root: string
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'prem-format-'))
})
afterEach(() => rm(root, { recursive: true, force: true }))

describe('checkVaultFormat', () => {
  it('records the format the first time a vault is opened, and accepts it after', async () => {
    await checkVaultFormat(root)
    expect(JSON.parse(await readFile(path.join(root, '.prem', 'format.json'), 'utf8'))).toEqual({
      version: VAULT_FORMAT
    })
    await expect(checkVaultFormat(root)).resolves.toBeUndefined()
  })

  it('refuses a vault from a newer Prem, and a damaged format file', async () => {
    await mkdir(path.join(root, '.prem'))
    await writeFile(path.join(root, '.prem', 'format.json'), JSON.stringify({ version: VAULT_FORMAT + 1 }))
    await expect(checkVaultFormat(root)).rejects.toThrow(/newer version of Prem/)
    await writeFile(path.join(root, '.prem', 'format.json'), '{ not json')
    await expect(checkVaultFormat(root)).rejects.toThrow(/can't be read/)
  })
})
