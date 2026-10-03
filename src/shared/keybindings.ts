// keybindings.json: the person's changes to the default shortcuts, VS Code style.
//
//   [
//     { "key": "Mod+Shift+L", "command": "format.link" },   // give a command a different shortcut
//     { "command": "-note.today" }                          // take a command's shortcut away
//   ]
//
// Only changes are written; everything else keeps its default from shared/commands.ts. Later entries win.

import {
  commandById,
  COMMANDS,
  defaultBindings,
  parseKey,
  type Command,
  type KeyBinding,
  type KeyEventLike
} from './commands'

export interface KeybindingEntry {
  /** A shortcut such as "Mod+Shift+L". Absent when the entry removes a shortcut. */
  key?: string
  /** A command id, or "-" and a command id to remove its shortcut. */
  command: string
}

/** What the app is using, and what's wrong with keybindings.json if anything. */
export interface KeybindingsSnapshot {
  /** The entries that could be used, in file order. */
  entries: KeybindingEntry[]
  problems: string[]
  /** Why the file couldn't be read as JSON. The last good shortcuts stay in use until it's fixed. */
  error: string | null
  file: string
}

const LOCATION = ' in keybindings.json'

/** Reads the parsed contents of keybindings.json, keeping every entry that can be used. */
export function validateKeybindings(raw: unknown): { entries: KeybindingEntry[]; problems: string[] } {
  if (!Array.isArray(raw)) {
    return {
      entries: [],
      problems: ['keybindings.json must contain a list, like [{ "key": "Mod+Shift+L", "command": "format.link" }]']
    }
  }
  const entries: KeybindingEntry[] = []
  const problems: string[] = []
  raw.forEach((item: unknown, i) => {
    const where = `Entry ${i + 1}${LOCATION}`
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      problems.push(`${where} must be an object with "key" and "command"`)
      return
    }
    const { key, command } = item as Record<string, unknown>
    if (typeof command !== 'string' || !command) {
      problems.push(`${where} needs a "command"`)
      return
    }
    const id = command.replace(/^-/, '')
    if (!commandById(id)) {
      problems.push(`${where}: unknown command "${id}"`)
      return
    }
    if (command.startsWith('-')) {
      entries.push({ command })
      return
    }
    if (typeof key !== 'string' || !parseKey(key)) {
      problems.push(`${where}: "${String(key)}" isn't a shortcut Prem understands, e.g. "Mod+Shift+L"`)
      return
    }
    const binding = parseKey(key)!
    if (!allowedAlone(binding)) {
      problems.push(`${where}: "${key}" needs Mod or Alt, so it doesn't get in the way of typing`)
      return
    }
    entries.push({ key, command })
  })
  return { entries, problems }
}

/** The shortcut each command has after applying the person's entries to the defaults. */
export function resolveBindings(entries: KeybindingEntry[]): Map<string, KeyBinding> {
  const bindings = defaultBindings()
  for (const entry of entries) {
    if (entry.command.startsWith('-')) {
      bindings.delete(entry.command.slice(1))
      continue
    }
    const binding = entry.key ? parseKey(entry.key) : null
    if (binding) bindings.set(entry.command, binding)
  }
  return bindings
}

export const sameKey = (a: KeyBinding, b: KeyBinding): boolean =>
  a.code === b.code && a.mod === b.mod && a.shift === b.shift && a.alt === b.alt

/** Other commands that use the same shortcut. */
export function conflictsWith(bindings: Map<string, KeyBinding>, command: string, binding: KeyBinding): string[] {
  return [...bindings].filter(([id, b]) => id !== command && sameKey(b, binding)).map(([id]) => id)
}

/** Whether a command's shortcut differs from its default. */
export function isCustomized(entries: KeybindingEntry[], command: string): boolean {
  return entries.some((e) => e.command === command || e.command === `-${command}`)
}

/**
 * The file content after giving `command` a new shortcut, or none (`null`). Setting it back to the default
 * removes the person's entries for it, so the file only ever lists what they changed. Entries for other
 * commands, including ones Prem doesn't know, are kept as they were.
 */
export function withBinding(raw: unknown[], command: string, key: string | null): unknown[] {
  const def = commandById(command)
  if (!def) throw new Error(`Unknown command "${command}"`)
  const binding = key === null ? null : parseKey(key)
  if (key !== null && !binding) throw new Error(`"${key}" isn't a shortcut Prem understands`)
  if (binding && !allowedAlone(binding))
    throw new Error("Use Mod or Alt, so the shortcut doesn't get in the way of typing")

  const others = raw.filter((item) => {
    const c = item && typeof item === 'object' ? (item as Record<string, unknown>).command : undefined
    return c !== command && c !== `-${command}`
  })
  const defaultKey = def.key ? parseKey(def.key) : null
  if (binding && defaultKey && sameKey(binding, defaultKey)) return others
  if (!binding) return defaultKey ? [...others, { command: `-${command}` }] : others
  return [...others, { key: keyText(binding), command }]
}

/** Puts every command back to its default shortcut. */
export function resetBinding(raw: unknown[], command: string): unknown[] {
  const def = commandById(command)
  return withBinding(raw, command, def?.key ?? null)
}

const NAMES: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Slash: '/',
  Comma: ',',
  Period: '.',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Equal: '=',
  Minus: '-',
  Enter: 'Enter',
  Escape: 'Escape',
  Tab: 'Tab',
  Space: 'Space',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

function keyName(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit[0-9]$/.test(code)) return code.slice(5)
  if (/^F([1-9]|1[0-2])$/.test(code)) return code
  return NAMES[code] ?? null
}

/** How a shortcut is written in keybindings.json, e.g. "Mod+Shift+L". The inverse of parseKey. */
export function keyText(binding: KeyBinding): string {
  return [binding.mod && 'Mod', binding.alt && 'Alt', binding.shift && 'Shift', keyName(binding.code)]
    .filter(Boolean)
    .join('+')
}

/**
 * Plain keys type text, so a shortcut needs Mod or Alt. Function keys are the exception. Shift alone
 * isn't enough either: Shift+A is just a capital A.
 */
function allowedAlone(binding: KeyBinding): boolean {
  return binding.mod || binding.alt || /^F\d+$/.test(binding.code)
}

/**
 * The shortcut a key press makes, for recording a new one. Null while only modifiers are held, for keys Prem
 * can't bind, and for combinations that would get in the way of typing.
 */
export function bindingFromEvent(e: KeyEventLike, mac: boolean): KeyBinding | null {
  if (!keyName(e.code) || (mac ? e.ctrlKey : e.metaKey)) return null
  const binding = { mod: mac ? e.metaKey : e.ctrlKey, shift: e.shiftKey, alt: e.altKey, code: e.code }
  return allowedAlone(binding) ? binding : null
}

/** Every command, for listing in the Shortcuts tab. */
export const ALL_COMMANDS = COMMANDS as readonly Command[]
