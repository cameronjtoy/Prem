// Everything a person can set, in one place: the Settings screen is built from this list, and settings.json
// is checked against it. The file holds only what someone changed, keyed like "appearance.theme".

export type SettingSection = 'Appearance' | 'Editor' | 'Notebook' | 'Analysis' | 'Export' | 'Updates'

interface Base {
  key: string
  section: SettingSection
  title: string
  description: string
}

export type SettingDef =
  | (Base & { type: 'enum'; options: { value: string; label: string }[]; default: string })
  | (Base & { type: 'boolean'; default: boolean })
  | (Base & { type: 'number'; min: number; max: number; step?: number; unit?: string; default: number })
  | (Base & { type: 'string'; pattern?: RegExp; patternHint?: string; optional?: boolean; default: string })

export const SETTINGS = [
  {
    key: 'appearance.theme',
    section: 'Appearance',
    title: 'Theme',
    description: 'Light or dark, or follow your computer.',
    type: 'enum',
    options: [
      { value: 'system', label: 'Match the system' },
      { value: 'light', label: 'Light' },
      { value: 'dark', label: 'Dark' }
    ],
    default: 'system'
  },
  {
    key: 'appearance.textSize',
    section: 'Appearance',
    title: 'Text size in notes',
    description: 'Size of the text you write, in pixels. View → Larger text zooms everything instead.',
    type: 'number',
    min: 12,
    max: 28,
    unit: 'px',
    default: 16
  },
  {
    key: 'appearance.noteFont',
    section: 'Appearance',
    title: 'Font in notes',
    description: 'The typeface of the text you write. Headings are always in the serif.',
    type: 'enum',
    options: [
      { value: 'sans', label: 'Sans serif (Inter)' },
      { value: 'serif', label: 'Serif (Source Serif)' }
    ],
    default: 'sans'
  },
  {
    key: 'appearance.editorWidth',
    section: 'Appearance',
    title: 'Line width',
    description: 'How wide notes are laid out. Wide tables and images always use the full width.',
    type: 'enum',
    options: [
      { value: 'narrow', label: 'Narrow (easier to read)' },
      { value: 'wide', label: 'Wide' },
      { value: 'full', label: 'Full window' }
    ],
    default: 'wide'
  },
  {
    key: 'editor.spellcheck',
    section: 'Editor',
    title: 'Check spelling',
    description: 'Underline misspelled words as you type.',
    type: 'boolean',
    default: true
  },
  {
    key: 'editor.lineNumbers',
    section: 'Editor',
    title: 'Line numbers',
    description: 'Show line numbers beside notes.',
    type: 'boolean',
    default: false
  },
  {
    key: 'editor.autosaveDelay',
    section: 'Editor',
    title: 'Save after',
    description: 'How long after you stop typing a note is saved.',
    type: 'number',
    min: 200,
    max: 10000,
    step: 100,
    unit: 'ms',
    default: 600
  },
  {
    key: 'editor.timestampFormat',
    section: 'Editor',
    title: 'Inserted date and time',
    description: 'Format for Insert Date and Time. YYYY, MM, DD, HH (24-hour) and mm are replaced.',
    type: 'string',
    pattern: /(YYYY|MM|DD|HH|mm)/,
    patternHint: 'Use at least one of YYYY, MM, DD, HH or mm.',
    default: 'YYYY-MM-DD HH:mm'
  },
  {
    key: 'notebook.folder',
    section: 'Notebook',
    title: 'Notebook folder',
    description:
      "Where today's entries and protocol runs go in a vault on this computer. Lab servers use each person's folder under Notebooks.",
    type: 'string',
    pattern: /^(?!\.)(?!.*\/\.)[^/\\]+(\/[^/\\]+)*$/,
    patternHint: 'A folder inside the vault, such as "Notebook" or "Lab notebook/2026".',
    default: 'Notebook'
  },
  {
    key: 'notebook.confirmTrash',
    section: 'Notebook',
    title: 'Ask before moving to trash',
    description: 'Confirm before a note or folder is moved to the trash.',
    type: 'boolean',
    default: true
  },
  {
    key: 'samples.folder',
    section: 'Notebook',
    title: 'Samples folder',
    description: 'Where new samples go. Samples anywhere in the vault are listed in the Samples view.',
    type: 'string',
    pattern: /^(?!\.)(?!.*\/\.)[^/\\]+(\/[^/\\]+)*$/,
    patternHint: 'A folder inside the vault, such as "Samples".',
    default: 'Samples'
  },
  {
    key: 'samples.idFormat',
    section: 'Notebook',
    title: 'Sample IDs',
    description:
      'How new sample IDs look. {####} counts up from the highest ID already used, with as many digits as #; {YYYY}, {YY} and {MM} are the date.',
    type: 'string',
    pattern: /\{#+\}/,
    patternHint: 'Include a counter such as {####}.',
    default: 'S-{####}'
  },
  {
    key: 'analysis.enabled',
    section: 'Analysis',
    title: 'Run Python in notes',
    description: 'Show Run on ```python {run} blocks. Code only ever runs when you choose Run.',
    type: 'boolean',
    default: true
  },
  {
    key: 'analysis.python',
    section: 'Analysis',
    title: 'Python',
    description: 'Path to the Python to use. Leave empty to use uv if it is installed, or python3.',
    type: 'string',
    optional: true,
    default: ''
  },
  {
    key: 'analysis.timeout',
    section: 'Analysis',
    title: 'Stop a cell after',
    description: 'A cell running longer than this is stopped, and the variables from earlier cells are lost.',
    type: 'number',
    min: 5,
    max: 3600,
    step: 5,
    unit: 's',
    default: 300
  },
  {
    key: 'export.pageSize',
    section: 'Export',
    title: 'PDF page size',
    description: 'Paper size for exported PDFs.',
    type: 'enum',
    options: [
      { value: 'A4', label: 'A4' },
      { value: 'Letter', label: 'US Letter' }
    ],
    default: 'A4'
  },
  {
    key: 'updates.check',
    section: 'Updates',
    title: 'Check for updates',
    description:
      'Once a day, look for a new version of Prem on GitHub and download it, then offer to restart. Your notes are never sent anywhere.',
    type: 'boolean',
    default: true
  }
] as const satisfies readonly SettingDef[]

type Defs = (typeof SETTINGS)[number]
export type SettingKey = Defs['key']
export type Settings = {
  [D in Defs as D['key']]: D['type'] extends 'boolean' ? boolean : D['type'] extends 'number' ? number : string
}

export const DEFAULTS = Object.fromEntries(SETTINGS.map((s) => [s.key, s.default])) as Settings

export function settingDef(key: string): SettingDef | undefined {
  return (SETTINGS as readonly SettingDef[]).find((s) => s.key === key)
}

/** Checks one value. Returns the cleaned value, or a message saying what's wrong. */
export function checkValue(def: SettingDef, value: unknown): { value: unknown } | { problem: string } {
  switch (def.type) {
    case 'boolean':
      return typeof value === 'boolean' ? { value } : { problem: `"${def.key}" must be true or false` }
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) return { problem: `"${def.key}" must be a number` }
      if (value < def.min || value > def.max)
        return { problem: `"${def.key}" must be between ${def.min} and ${def.max}${def.unit ? ` ${def.unit}` : ''}` }
      return { value }
    case 'enum':
      return def.options.some((o) => o.value === value)
        ? { value }
        : { problem: `"${def.key}" must be one of ${def.options.map((o) => `"${o.value}"`).join(', ')}` }
    case 'string': {
      if (typeof value !== 'string') return { problem: `"${def.key}" must be text` }
      const trimmed = value.trim()
      if (!trimmed && def.optional) return { value: '' }
      if (!trimmed || (def.pattern && !def.pattern.test(trimmed)))
        return { problem: `"${def.key}": ${def.patternHint ?? 'not a valid value'}` }
      return { value: trimmed }
    }
  }
}

export interface Validated {
  values: Settings
  /** One line per setting that was ignored, and why. The default is used for those. */
  problems: string[]
}

/** Reads the parsed contents of settings.json. Anything wrong falls back to its default and is reported. */
export function validate(raw: unknown): Validated {
  const values = { ...DEFAULTS } as Record<string, unknown>
  const problems: string[] = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      values: DEFAULTS,
      problems: ['settings.json must contain a JSON object, like { "appearance.theme": "dark" }']
    }
  }
  for (const [key, value] of Object.entries(raw)) {
    const def = settingDef(key)
    if (!def) {
      problems.push(`Unknown setting "${key}"`)
      continue
    }
    const result = checkValue(def, value)
    if ('problem' in result) problems.push(result.problem)
    else values[key] = result.value
  }
  return { values: values as Settings, problems }
}

/**
 * The file content after changing one setting: setting it back to its default removes it, so the file
 * only ever lists what someone chose. Other entries, including unknown ones, are kept as they were.
 */
export function withSetting(raw: Record<string, unknown>, key: SettingKey, value: unknown): Record<string, unknown> {
  const def = settingDef(key)
  if (!def) throw new Error(`Unknown setting "${key}"`)
  const result = checkValue(def, value)
  if ('problem' in result) throw new Error(result.problem)
  const next = { ...raw }
  if (result.value === def.default) delete next[key]
  else next[key] = result.value
  return next
}

/** Where a JSON syntax error is and what it is, as "line 3, column 1: Expected double-quoted property name". */
export function syntaxErrorLocation(text: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const reason = message
    .replace(/\s*in JSON at position.*$/i, '')
    .replace(/\s*\(line \d+ column \d+\)$/, '')
    .replace(/,\s*"[\s\S]*" is not valid JSON$/, '')
  const lineCol = /line (\d+) column (\d+)/i.exec(message)
  if (lineCol) return `line ${lineCol[1]}, column ${lineCol[2]}: ${reason}`
  const position = /position (\d+)/i.exec(message)
  const offset = position
    ? Number(position[1])
    : /end of JSON/i.test(message)
      ? text.trimEnd().length
      : jsonErrorOffset(text)
  const before = text.slice(0, offset)
  const line = before.split('\n').length
  return `line ${line}, column ${before.length - before.lastIndexOf('\n')}: ${reason}`
}

/**
 * Where JSON stops being valid, for parser messages that don't say (V8 reports some errors only as
 * 'Unexpected token X, "..." is not valid JSON'). A small strict JSON scanner; returns the offset of the
 * first character that can't be there.
 */
export function jsonErrorOffset(text: string): number {
  let i = 0
  const fail = (): never => {
    throw i
  }
  const space = (): void => {
    while (/\s/.test(text[i] ?? '')) i++
  }
  const literal = (word: string): void => {
    for (const ch of word) {
      if (text[i] !== ch) fail()
      i++
    }
  }
  const string = (): void => {
    if (text[i] !== '"') fail()
    i++
    while (text[i] !== '"') {
      if (i >= text.length || text[i] < ' ') fail()
      if (text[i] === '\\') i++
      i++
    }
    i++
  }
  const number = (): void => {
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(text.slice(i))
    if (!m) fail()
    i += m![0].length
  }
  const list = (close: string, item: () => void): void => {
    i++
    space()
    if (text[i] === close) return void i++
    for (;;) {
      item()
      space()
      if (text[i] === ',') {
        i++
        space()
        continue
      }
      if (text[i] === close) return void i++
      fail()
    }
  }
  const value = (): void => {
    space()
    const ch = text[i]
    if (ch === '{')
      list('}', () => {
        string()
        space()
        if (text[i] !== ':') fail()
        i++
        value()
      })
    else if (ch === '[') list(']', value)
    else if (ch === '"') string()
    else if (ch === 't') literal('true')
    else if (ch === 'f') literal('false')
    else if (ch === 'n') literal('null')
    else number()
  }
  try {
    value()
    space()
    return i < text.length ? i : text.length
  } catch (at) {
    return Math.min(typeof at === 'number' ? at : 0, text.length)
  }
}

/** What the app is using, and what's wrong with settings.json if anything. */
export interface SettingsSnapshot {
  values: Settings
  problems: string[]
  /**
   * Why the file couldn't be read as JSON, e.g. "line 3, column 1: Expected double-quoted property name".
   * The last good settings stay in use until it's fixed.
   */
  error: string | null
  /** Where settings.json is. */
  file: string
}
