import { describe, expect, it } from 'vitest'
import { COMMANDS, parseKey, type Command } from './commands'
import {
  bindingFromEvent,
  conflictsWith,
  isCustomized,
  keyText,
  resetBinding,
  resolveBindings,
  validateKeybindings,
  withBinding
} from './keybindings'

const press = (code: string, mods: Partial<Record<'meta' | 'ctrl' | 'shift' | 'alt', boolean>> = {}) => ({
  code,
  metaKey: !!mods.meta,
  ctrlKey: !!mods.ctrl,
  shiftKey: !!mods.shift,
  altKey: !!mods.alt
})

describe('validateKeybindings', () => {
  it('keeps good entries and reports the rest', () => {
    const { entries, problems } = validateKeybindings([
      { key: 'Mod+Shift+L', command: 'format.link' },
      { command: '-note.today' },
      { key: 'Mod+Shift+L', command: 'note.dance' },
      { key: 'Mod+Hyper+L', command: 'format.bold' },
      { key: 'L', command: 'format.italic' },
      'format.strike',
      { key: 'Mod+J' }
    ])
    expect(entries).toEqual([{ key: 'Mod+Shift+L', command: 'format.link' }, { command: '-note.today' }])
    expect(problems).toEqual([
      'Entry 3 in keybindings.json: unknown command "note.dance"',
      'Entry 4 in keybindings.json: "Mod+Hyper+L" isn\'t a shortcut Prem understands, e.g. "Mod+Shift+L"',
      'Entry 5 in keybindings.json: "L" needs Mod or Alt, so it doesn\'t get in the way of typing',
      'Entry 6 in keybindings.json must be an object with "key" and "command"',
      'Entry 7 in keybindings.json needs a "command"'
    ])
  })

  it('needs a list', () => {
    expect(validateKeybindings({ 'format.link': 'Mod+L' }).problems[0]).toMatch(/must contain a list/)
  })
})

describe('resolveBindings', () => {
  it('applies changes and removals on top of the defaults, later entries winning', () => {
    const bindings = resolveBindings([
      { key: 'Mod+Shift+L', command: 'format.link' },
      { command: '-note.today' },
      { key: 'Mod+Alt+L', command: 'format.link' },
      { key: 'F5', command: 'help.website' }
    ])
    expect(bindings.get('format.link')).toEqual(parseKey('Mod+Alt+L'))
    expect(bindings.has('note.today')).toBe(false)
    expect(bindings.get('help.website')).toEqual(parseKey('F5'))
    expect(bindings.get('app.search')).toEqual(parseKey('Mod+K'))
  })

  it('finds other commands using a shortcut', () => {
    const bindings = resolveBindings([])
    expect(conflictsWith(bindings, 'format.link', parseKey('Mod+K')!)).toEqual(['app.search'])
    expect(conflictsWith(bindings, 'app.search', parseKey('Mod+K')!)).toEqual([])
  })
})

describe('withBinding', () => {
  it('writes only changes from the defaults, and keeps other entries', () => {
    const raw = [{ key: 'Mod+J', command: 'someone.elses' }]
    const changed = withBinding(raw, 'format.link', 'Mod+Shift+L')
    expect(changed).toEqual([...raw, { key: 'Mod+Shift+L', command: 'format.link' }])
    expect(withBinding(changed, 'format.link', 'Mod+L')).toEqual(raw)
    expect(withBinding(changed, 'format.link', null)).toEqual([...raw, { command: '-format.link' }])
    expect(resetBinding(withBinding(changed, 'format.link', null), 'format.link')).toEqual(raw)
  })

  it('removes nothing for a command that has no default shortcut', () => {
    expect(withBinding([], 'help.website', null)).toEqual([])
    expect(isCustomized(withBinding([], 'help.website', 'F1') as never, 'help.website')).toBe(true)
  })

  it('refuses shortcuts that would get in the way of typing', () => {
    expect(() => withBinding([], 'format.link', 'Shift+L')).toThrow(/Mod or Alt/)
    expect(() => withBinding([], 'format.nothing', 'Mod+L')).toThrow(/Unknown command/)
  })
})

describe('keys', () => {
  it('writes every default shortcut so it reads back the same', () => {
    for (const c of COMMANDS as readonly Command[]) {
      if (!c.key) continue
      expect(parseKey(keyText(parseKey(c.key)!))).toEqual(parseKey(c.key))
    }
  })

  it('records shortcuts from key presses', () => {
    expect(bindingFromEvent(press('KeyL', { meta: true, shift: true }), true)).toEqual(parseKey('Mod+Shift+L'))
    expect(bindingFromEvent(press('KeyL', { ctrl: true }), false)).toEqual(parseKey('Mod+L'))
    expect(bindingFromEvent(press('KeyL', { ctrl: true }), true)).toBeNull()
    expect(bindingFromEvent(press('KeyL', { shift: true }), true)).toBeNull()
    expect(bindingFromEvent(press('ShiftLeft', { shift: true }), true)).toBeNull()
    expect(bindingFromEvent(press('F2'), true)).toEqual(parseKey('F2'))
  })
})
