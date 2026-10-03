import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { KeybindingsStore } from './keybindings'

async function store(content?: string): Promise<{ store: KeybindingsStore; file: string }> {
  const file = path.join(await mkdtemp(path.join(tmpdir(), 'prem-keys-')), 'keybindings.json')
  if (content !== undefined) await writeFile(file, content)
  return { store: new KeybindingsStore(file), file }
}

describe('KeybindingsStore', () => {
  it('has no changes when there is no file', async () => {
    const { store: s } = await store()
    expect(await s.load()).toMatchObject({ entries: [], problems: [], error: null })
  })

  it('saves a new shortcut, a removal and a reset, keeping entries it does not know', async () => {
    const { store: s, file } = await store('[{ "key": "Mod+J", "command": "-another.app" }]')
    await s.load()
    await s.set('format.link', 'Mod+Shift+L')
    await s.set('note.today', null)
    const read = async (): Promise<unknown> => JSON.parse(await readFile(file, 'utf8'))
    expect(await read()).toEqual([
      { key: 'Mod+J', command: '-another.app' },
      { key: 'Mod+Shift+L', command: 'format.link' },
      { command: '-note.today' }
    ])
    expect(s.current.problems).toEqual(['Entry 1 in keybindings.json: unknown command "another.app"'])
    await s.reset('note.today')
    expect(s.current.entries).toEqual([{ key: 'Mod+Shift+L', command: 'format.link' }])
  })

  it('refuses to save over a file with a syntax error', async () => {
    const { store: s } = await store('[{ "key": "Mod+J", }]')
    expect((await s.load()).error).toMatch(/^line 1/)
    await expect(s.set('format.link', 'Mod+Shift+L')).rejects.toThrow(/keybindings.json has a mistake/)
  })
})
