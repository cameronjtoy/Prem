import { mkdtemp, readFile, realpath, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { runCli, watchConfig, type CliIO } from './cli'
import { hashToken, loadConfig } from './config'

let dir: string
let file: string
let output: string[]

const io = (answers?: string[]): CliIO => ({
  out: (line) => output.push(line),
  ask: answers ? async (_q, fallback) => answers.shift() || fallback || '' : null,
  log: { info: () => {}, error: () => {} }
})

const tokensIn = (lines: string[]): Record<string, string> =>
  Object.fromEntries(
    lines
      .flatMap((l) => l.split('\n'))
      .flatMap((l) => {
        const m = /^ {2}(.+?)\s+(prem_\S+)$/.exec(l)
        return m ? [[m[1].trim(), m[2]]] : []
      })
  )

beforeEach(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), 'prem-cli-')))
  file = path.join(dir, 'prem-server.json')
  output = []
})

describe('init', () => {
  it('sets up a lab from flags, with a token for each person', async () => {
    await runCli(['init', '--config', file, '--pi', 'pat', '--members', 'alice, bob', '--host', '0.0.0.0'], io())
    const config = await loadConfig(file)
    expect(config.vault).toBe(path.join(dir, 'vault'))
    expect(config.host).toBe('0.0.0.0')
    expect(config.users.map((u) => u.name)).toEqual(['pat', 'alice', 'bob'])

    const tokens = tokensIn(output)
    expect(Object.keys(tokens)).toEqual(['pat', 'alice', 'bob'])
    for (const user of config.users) expect(user.tokenHash).toBe(hashToken(tokens[user.name]))

    for (const folder of ['Protocols', 'Samples', 'Notebooks/pat', 'Notebooks/alice', 'Notebooks/bob']) {
      expect((await stat(path.join(dir, 'vault', folder))).isDirectory()).toBe(true)
    }
  })

  it.skipIf(process.platform === 'win32')(
    'makes the config readable only by its owner, since it lists token hashes',
    async () => {
      await runCli(['init', '--config', file, '--pi', 'pat'], io())
      expect((await stat(file)).mode & 0o077).toBe(0)
    }
  )

  it('asks questions in a terminal', async () => {
    await runCli(['init', '--config', file], io(['labvault', 'Pat Lee', 'alice', 'n', '', '5000']))
    const config = await loadConfig(file)
    expect(config.vault).toBe(path.join(dir, 'labvault'))
    expect(config.port).toBe(5000)
    expect(config.host).toBe('127.0.0.1')
    const alice = config.users.find((u) => u.name === 'alice')
    expect(alice?.access.Notebooks).toBe('none')
  })

  it("won't overwrite an existing config", async () => {
    await writeFile(file, '{}')
    await expect(runCli(['init', '--config', file, '--pi', 'pat'], io())).rejects.toThrow(/already exists/)
  })

  it('needs a terminal or flags', async () => {
    await expect(runCli(['init', '--config', file], io())).rejects.toThrow(/in a terminal/)
  })
})

describe('managing people', () => {
  beforeEach(async () => {
    await runCli(['init', '--config', file, '--pi', 'pat', '--members', 'alice'], io())
    output = []
  })

  it('adds a person with a role and makes their notebook', async () => {
    await runCli(['add', 'Bo Chen', '--role', 'viewer', '--config', file], io())
    const bo = (await loadConfig(file)).users.find((u) => u.name === 'Bo Chen')
    expect(bo?.tokenHash).toBe(hashToken(tokensIn(output)['Bo Chen']))
    expect(bo?.access).toEqual({ '': 'read', Notebooks: 'read' })
    expect((await stat(path.join(dir, 'vault', 'Notebooks', 'Bo Chen'))).isDirectory()).toBe(true)
  })

  it('rejects unknown roles', async () => {
    await expect(runCli(['add', 'bo', '--role', 'admin', '--config', file], io())).rejects.toThrow(/Unknown role/)
  })

  it('removes a person', async () => {
    await runCli(['remove', 'alice', '--config', file], io())
    expect((await loadConfig(file)).users.map((u) => u.name)).toEqual(['pat'])
  })

  it('replaces a token', async () => {
    const before = (await loadConfig(file)).users[1].tokenHash
    await runCli(['token', 'alice', '--config', file], io())
    const after = (await loadConfig(file)).users[1].tokenHash
    expect(after).not.toBe(before)
    expect(after).toBe(hashToken(tokensIn(output).alice))
  })

  it('lists people', async () => {
    await runCli(['list', '--config', file], io())
    expect(output).toEqual([
      'pat (pi): writes everything, Notebooks/pat',
      'alice (member): writes Notebooks/alice, Samples, Jobs'
    ])
  })

  it('keeps fields it does not know about', async () => {
    const raw = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>
    await writeFile(file, JSON.stringify({ ...raw, note: 'backups at 2am' }))
    await runCli(['add', 'bo', '--config', file], io())
    expect(JSON.parse(await readFile(file, 'utf8')).note).toBe('backups at 2am')
  })
})

describe('watchConfig', () => {
  it('calls back once after the file is replaced', async () => {
    await writeFile(file, '{}')
    let calls = 0
    const stop = watchConfig(file, () => calls++)
    await new Promise((r) => setTimeout(r, 100))
    await writeFile(`${file}.tmp`, '{"a":1}')
    const { rename } = await import('node:fs/promises')
    await rename(`${file}.tmp`, file)
    await writeFile(file, '{"a":2}')
    await new Promise((r) => setTimeout(r, 700))
    stop()
    expect(calls).toBe(1)
  })
})
