import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  accelerator,
  commandForKey,
  COMMANDS,
  defaultBindings,
  formatKey,
  matches,
  parseKey,
  type Command
} from './commands'

const press = (code: string, mods: Partial<Record<'meta' | 'ctrl' | 'shift' | 'alt', boolean>> = {}) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

describe('command list', () => {
  it('has unique ids and unique default shortcuts', () => {
    const ids = COMMANDS.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    const keys = (COMMANDS as readonly Command[]).filter((c) => c.key).map((c) => JSON.stringify(parseKey(c.key!)))
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('only uses shortcuts that parse', () => {
    const unparsable = (COMMANDS as readonly Command[]).filter((c) => c.key && !parseKey(c.key)).map((c) => c.id)
    expect(unparsable).toEqual([])
  })

  it('keeps the shortcuts Prem already had', () => {
    const bindings = defaultBindings()
    expect(bindings.get('app.search')).toEqual(parseKey('Mod+K'))
    expect(bindings.get('note.today')).toEqual(parseKey('Mod+T'))
    expect(bindings.get('note.exportPdf')).toEqual(parseKey('Mod+P'))
  })
})

describe('keys', () => {
  it('parses names, punctuation and modifiers', () => {
    expect(parseKey('Mod+Shift+P')).toEqual({ mod: true, shift: true, alt: false, code: 'KeyP' })
    expect(parseKey('Mod+[')).toEqual({ mod: true, shift: false, alt: false, code: 'BracketLeft' })
    expect(parseKey('Mod+Alt+1')).toEqual({ mod: true, shift: false, alt: true, code: 'Digit1' })
    expect(parseKey('mod+enter')?.code).toBe('Enter')
    expect(parseKey('Mod+Hyper+P')).toBeNull()
    expect(parseKey('Mod++')).toBeNull()
    expect(parseKey('Mod+Ü')).toBeNull()
  })

  it('treats Mod as ⌘ on macOS and Ctrl elsewhere', () => {
    const b = parseKey('Mod+K')!
    expect(matches(b, press('KeyK', { meta: true }), true)).toBe(true)
    expect(matches(b, press('KeyK', { ctrl: true }), true)).toBe(false)
    expect(matches(b, press('KeyK', { ctrl: true }), false)).toBe(true)
    expect(matches(b, press('KeyK', { ctrl: true, meta: true }), false)).toBe(false)
  })

  it('needs exactly the right modifiers', () => {
    const bindings = defaultBindings()
    expect(commandForKey(bindings, press('KeyN', { meta: true }), true)).toBe('note.new')
    expect(commandForKey(bindings, press('KeyN', { meta: true, shift: true }), true)).toBe('note.newFromTemplate')
    expect(commandForKey(bindings, press('Backslash', { meta: true, shift: true }), true)).toBe('view.toggleLinks')
    expect(commandForKey(bindings, press('KeyN'), true)).toBeUndefined()
  })

  it('shows shortcuts the way each platform writes them', () => {
    expect(formatKey(parseKey('Mod+Shift+P')!, true)).toBe('⇧⌘P')
    expect(formatKey(parseKey('Mod+Shift+P')!, false)).toBe('Ctrl+Shift+P')
    expect(formatKey(parseKey('Mod+Alt+1')!, true)).toBe('⌥⌘1')
    expect(formatKey(parseKey('Mod+Enter')!, true)).toBe('⌘↵')
    expect(formatKey(parseKey('Mod+\\')!, false)).toBe('Ctrl+\\')
  })

  it('makes Electron menu accelerators', () => {
    expect(accelerator(parseKey('Mod+Shift+P')!)).toBe('CmdOrCtrl+Shift+P')
    expect(accelerator(parseKey('Mod+[')!)).toBe('CmdOrCtrl+[')
    expect(accelerator(parseKey('Mod+Enter')!)).toBe('CmdOrCtrl+Enter')
    expect(accelerator(parseKey('Alt+Up')!)).toBe('Alt+Up')
    expect(accelerator(parseKey('F5')!)).toBe('F5')
  })
})

/** The README lists every shortcut. Run with UPDATE_DOCS=1 to rewrite the table after changing the list. */
describe('README', () => {
  it('lists the same shortcuts as the command list', () => {
    const readme = path.resolve(__dirname, '../../README.md')
    const text = readFileSync(readme, 'utf8')
    const start = '<!-- shortcuts:start -->'
    const end = '<!-- shortcuts:end -->'
    const rows = (COMMANDS as readonly Command[])
      .filter((c) => c.key)
      .map((c) => `| ${formatKey(parseKey(c.key!)!, true).replace(/\\/g, '\\\\').replace(/\|/g, '\\|')} | ${c.title} |`)
    const table = ['| Shortcut (Ctrl on Windows and Linux) | Action |', '|---|---|', ...rows].join('\n')
    const expected = `${start}\n${table}\n${end}`
    const actual = text.slice(text.indexOf(start), text.indexOf(end) + end.length)
    if (process.env.UPDATE_DOCS && actual !== expected) {
      writeFileSync(readme, text.replace(actual, expected))
      return
    }
    expect(actual).toBe(expected)
  })
})
