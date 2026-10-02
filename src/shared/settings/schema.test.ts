import { describe, expect, it } from 'vitest'
import { DEFAULTS, SETTINGS, syntaxErrorLocation, validate, withSetting } from './schema'

const folderOk = (folder: string): boolean => validate({ 'notebook.folder': folder }).problems.length === 0

const location = (text: string): string => {
  try {
    JSON.parse(text)
  } catch (e) {
    return syntaxErrorLocation(text, e)
  }
  throw new Error('expected a syntax error')
}

describe('settings schema', () => {
  it('has unique keys and valid defaults', () => {
    const keys = SETTINGS.map((s) => s.key)
    expect(new Set(keys).size).toBe(keys.length)
    expect(validate(DEFAULTS).problems).toEqual([])
  })

  it('uses defaults for anything not set', () => {
    const { values, problems } = validate({ 'appearance.theme': 'dark' })
    expect(problems).toEqual([])
    expect(values['appearance.theme']).toBe('dark')
    expect(values['appearance.textSize']).toBe(16)
    expect(values['editor.spellcheck']).toBe(true)
  })

  it('reports bad values and unknown keys, keeping the defaults for them', () => {
    const { values, problems } = validate({
      'appearance.theme': 'purple',
      'appearance.textSize': 99,
      'editor.spellcheck': 'yes',
      'editor.timestampFormat': 'hello',
      'notebook.folder': '../outside',
      'appearance.fontFamily': 'Comic Sans'
    })
    expect(values).toEqual(DEFAULTS)
    expect(problems).toEqual([
      '"appearance.theme" must be one of "system", "light", "dark"',
      '"appearance.textSize" must be between 12 and 28 px',
      '"editor.spellcheck" must be true or false',
      '"editor.timestampFormat": Use at least one of YYYY, MM, DD, HH or mm.',
      '"notebook.folder": A folder inside the vault, such as "Notebook" or "Lab notebook/2026".',
      'Unknown setting "appearance.fontFamily"'
    ])
  })

  it('rejects a file that is not an object', () => {
    expect(validate([1, 2]).problems[0]).toMatch(/JSON object/)
    expect(validate('dark').values).toEqual(DEFAULTS)
  })

  it('keeps the notebook folder inside the vault', () => {
    expect(folderOk('Lab notebook/2026')).toBe(true)
    expect(['/abs', 'a/../b', 'a/', '.hidden', 'a//b', 'a\\b'].filter(folderOk)).toEqual([])
  })

  it('trims text values', () => {
    expect(validate({ 'notebook.folder': '  Lab notebook  ' }).values['notebook.folder']).toBe('Lab notebook')
  })
})

describe('withSetting', () => {
  it('writes only what differs from the default, and keeps everything else', () => {
    const raw = { 'appearance.theme': 'dark', 'my.note': 'kept' }
    expect(withSetting(raw, 'appearance.textSize', 18)).toEqual({ ...raw, 'appearance.textSize': 18 })
    expect(withSetting(raw, 'appearance.theme', 'system')).toEqual({ 'my.note': 'kept' })
  })

  it('refuses invalid values', () => {
    expect(() => withSetting({}, 'appearance.textSize', 4)).toThrow(/between 12 and 28/)
  })
})

describe('syntaxErrorLocation', () => {
  it('says which line and column, and what is wrong', () => {
    expect(location('{\n  "appearance.theme": "dark",\n}')).toMatch(/^line 3, column \d+: \S/)
  })

  it('points at the end of a file that stops early', () => {
    expect(location('{\n  "appearance.theme": [1,\n')).toMatch(/^line 2, column \d+: Unexpected end/)
  })
})
