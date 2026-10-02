import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULTS, type SettingsSnapshot } from '@shared/settings/schema'
import { SettingsStore } from './settings'

async function store(content?: string): Promise<{ store: SettingsStore; file: string; seen: SettingsSnapshot[] }> {
  const dir = await mkdtemp(path.join(tmpdir(), 'prem-settings-'))
  const file = path.join(dir, 'settings.json')
  if (content !== undefined) await writeFile(file, content)
  const seen: SettingsSnapshot[] = []
  return { store: new SettingsStore(file, (s) => seen.push(s)), file, seen }
}

describe('SettingsStore', () => {
  it('uses the defaults when there is no file', async () => {
    const { store: s } = await store()
    expect((await s.load()).values).toEqual(DEFAULTS)
  })

  it('reads the file and reports bad values', async () => {
    const { store: s } = await store('{ "appearance.theme": "dark", "editor.lineNumbers": "on" }')
    const snapshot = await s.load()
    expect(snapshot.values['appearance.theme']).toBe('dark')
    expect(snapshot.values['editor.lineNumbers']).toBe(false)
    expect(snapshot.problems).toEqual(['"editor.lineNumbers" must be true or false'])
  })

  it('keeps the last good settings while the file has a syntax error', async () => {
    const { store: s, file } = await store('{ "appearance.textSize": 20 }')
    await s.load()
    await writeFile(file, '{ "appearance.textSize": 22, }')
    const snapshot = await s.load()
    expect(snapshot.values['appearance.textSize']).toBe(20)
    expect(snapshot.error).toMatch(/^line 1, column \d+/)
    await expect(s.set('appearance.textSize', 18)).rejects.toThrow(/has a mistake at line 1/)
  })

  it('writes only what changed, and removes a setting put back to its default', async () => {
    const { store: s, file, seen } = await store('{\n  "my.comment": "kept"\n}\n')
    await s.load()
    await s.set('appearance.textSize', 18)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ 'my.comment': 'kept', 'appearance.textSize': 18 })
    await s.set('appearance.textSize', 16)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ 'my.comment': 'kept' })
    expect(seen.map((x) => x.values['appearance.textSize'])).toEqual([16, 18, 16])
  })

  it('refuses values outside what a setting allows', async () => {
    const { store: s } = await store()
    await expect(s.set('editor.autosaveDelay', 5)).rejects.toThrow(/between 200 and 10000/)
  })

  it('picks up edits made in another editor', async () => {
    const { store: s, file, seen } = await store('{}')
    await s.load()
    s.watch()
    try {
      await writeFile(file, '{ "appearance.theme": "light" }')
      await vi.waitFor(() => expect(s.values['appearance.theme']).toBe('light'), { timeout: 3000 })
      expect(seen.at(-1)?.values['appearance.theme']).toBe('light')
    } finally {
      s.close()
    }
  })
})
