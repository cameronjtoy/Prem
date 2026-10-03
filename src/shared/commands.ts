// Every command a person can run: from the keyboard, the application menu or the command palette.
//
// One list drives all three, plus the shortcuts sheet and the README table, so a shortcut can't be
// documented in one place and different in another. Keys are written once with `Mod`, which is ⌘ on
// macOS and Ctrl elsewhere, and matched on the physical key, so Shift and Alt don't change what's typed.

export type Category = 'General' | 'Navigate' | 'Note' | 'Format' | 'Run' | 'Analysis' | 'View'

export interface Command {
  id: string
  title: string
  category: Category
  /** Default shortcut, e.g. "Mod+Shift+P". */
  key?: string
}

export const COMMANDS = [
  { id: 'app.commandPalette', title: 'Command palette', category: 'General', key: 'Mod+Shift+P' },
  { id: 'app.shortcuts', title: 'Keyboard shortcuts', category: 'General', key: 'Mod+/' },
  { id: 'app.settings', title: 'Settings', category: 'General', key: 'Mod+,' },
  { id: 'app.search', title: 'Search all notes', category: 'Navigate', key: 'Mod+K' },
  { id: 'app.quickSwitcher', title: 'Go to note…', category: 'Navigate', key: 'Mod+E' },
  { id: 'nav.back', title: 'Back', category: 'Navigate', key: 'Mod+[' },
  { id: 'nav.forward', title: 'Forward', category: 'Navigate', key: 'Mod+]' },
  { id: 'note.today', title: "Today's entry", category: 'Note', key: 'Mod+T' },
  { id: 'note.new', title: 'New note', category: 'Note', key: 'Mod+N' },
  { id: 'note.newFromTemplate', title: 'New note from template', category: 'Note', key: 'Mod+Shift+N' },
  { id: 'vault.open', title: 'Open another vault', category: 'General', key: 'Mod+O' },
  { id: 'note.exportPdf', title: 'Export as PDF', category: 'Note', key: 'Mod+P' },
  { id: 'note.save', title: 'Save now', category: 'Note', key: 'Mod+S' },
  { id: 'note.history', title: 'History of this note', category: 'Note', key: 'Mod+Shift+H' },
  { id: 'note.reveal', title: 'Show in file list', category: 'Note', key: 'Mod+Shift+E' },
  { id: 'note.attach', title: 'Attach a file…', category: 'Note', key: 'Mod+Shift+A' },
  { id: 'note.insertDateTime', title: 'Insert date and time', category: 'Note', key: 'Mod+Shift+T' },
  { id: 'note.sign', title: 'Sign this record…', category: 'Note', key: 'Mod+Shift+S' },
  { id: 'run.start', title: 'Start a run of this protocol', category: 'Run', key: 'Mod+Shift+R' },
  { id: 'run.addDeviation', title: 'Add a deviation', category: 'Run', key: 'Mod+Shift+D' },
  { id: 'analysis.runCell', title: 'Run Python cell', category: 'Analysis', key: 'Shift+Enter' },
  { id: 'analysis.runAll', title: 'Run all Python cells', category: 'Analysis', key: 'Mod+Alt+Enter' },
  { id: 'analysis.stop', title: 'Stop running cell', category: 'Analysis' },
  { id: 'analysis.restart', title: 'Restart Python for this note', category: 'Analysis' },
  { id: 'analysis.reproduce', title: "Reproduce this note's outputs", category: 'Analysis' },
  { id: 'format.task', title: 'Tick or untick step', category: 'Format', key: 'Mod+Enter' },
  { id: 'format.bold', title: 'Bold', category: 'Format', key: 'Mod+B' },
  { id: 'format.italic', title: 'Italic', category: 'Format', key: 'Mod+I' },
  { id: 'format.strike', title: 'Strikethrough', category: 'Format', key: 'Mod+Shift+X' },
  { id: 'format.link', title: 'Insert link to a note', category: 'Format', key: 'Mod+L' },
  { id: 'format.heading1', title: 'Heading 1', category: 'Format', key: 'Mod+Alt+1' },
  { id: 'format.heading2', title: 'Heading 2', category: 'Format', key: 'Mod+Alt+2' },
  { id: 'format.heading3', title: 'Heading 3', category: 'Format', key: 'Mod+Alt+3' },
  { id: 'view.graph', title: 'Graph of links', category: 'View', key: 'Mod+G' },
  { id: 'view.toggleFiles', title: 'Show or hide the file list', category: 'View', key: 'Mod+\\' },
  { id: 'view.toggleLinks', title: 'Show or hide links', category: 'View', key: 'Mod+Shift+\\' },
  { id: 'help.website', title: 'Prem website and guides', category: 'General' },
  { id: 'help.reportIssue', title: 'Report a problem', category: 'General' }
] as const satisfies readonly Command[]

export type CommandId = (typeof COMMANDS)[number]['id']

export const COMMAND_IDS = new Set<string>(COMMANDS.map((c) => c.id))

export function commandById(id: string): Command | undefined {
  return (COMMANDS as readonly Command[]).find((c) => c.id === id)
}

export interface KeyBinding {
  mod: boolean
  shift: boolean
  alt: boolean
  /** The physical key, as KeyboardEvent.code (e.g. "KeyP", "Digit1", "BracketLeft"). */
  code: string
}

const CODES: Record<string, string> = {
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '\\': 'Backslash',
  '/': 'Slash',
  ',': 'Comma',
  '.': 'Period',
  ';': 'Semicolon',
  "'": 'Quote',
  '`': 'Backquote',
  '=': 'Equal',
  '-': 'Minus',
  enter: 'Enter',
  escape: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'ArrowUp',
  down: 'ArrowDown',
  left: 'ArrowLeft',
  right: 'ArrowRight'
}

function keyToCode(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  if (/^f([1-9]|1[0-2])$/i.test(key)) return key.toUpperCase()
  return CODES[key.toLowerCase()] ?? CODES[key] ?? null
}

/** Parses "Mod+Shift+P". Returns null for a combination Prem can't bind. */
export function parseKey(text: string): KeyBinding | null {
  const parts = text.split('+').map((p) => p.trim())
  // "Mod++" would split into empty parts; keys are written with names, so that's never valid.
  if (parts.some((p) => !p)) return null
  const key = parts.pop()!
  const mods = new Set(parts.map((p) => p.toLowerCase()))
  for (const m of mods) if (!['mod', 'shift', 'alt'].includes(m)) return null
  const code = keyToCode(key)
  if (!code) return null
  return { mod: mods.has('mod'), shift: mods.has('shift'), alt: mods.has('alt'), code }
}

export interface KeyEventLike {
  code: string
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** Whether a key press is exactly this shortcut. `Mod` is ⌘ on macOS and Ctrl elsewhere; the other must not be held. */
export function matches(binding: KeyBinding, e: KeyEventLike, mac: boolean): boolean {
  const mod = mac ? e.metaKey : e.ctrlKey
  const other = mac ? e.ctrlKey : e.metaKey
  return (
    e.code === binding.code && mod === binding.mod && !other && e.shiftKey === binding.shift && e.altKey === binding.alt
  )
}

const LABELS: Record<string, string> = {
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
  Space: 'Space',
  Tab: 'Tab',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→'
}

function keyLabel(code: string, mac: boolean): string {
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  if (code === 'Enter') return mac ? '↵' : 'Enter'
  return LABELS[code] ?? code
}

/** How a shortcut is shown: "⌘⇧P" on macOS, "Ctrl+Shift+P" elsewhere. */
export function formatKey(binding: KeyBinding, mac: boolean): string {
  const key = keyLabel(binding.code, mac)
  if (mac) return `${binding.alt ? '⌥' : ''}${binding.shift ? '⇧' : ''}${binding.mod ? '⌘' : ''}${key}`
  return [binding.mod && 'Ctrl', binding.alt && 'Alt', binding.shift && 'Shift', key].filter(Boolean).join('+')
}

/** An Electron menu accelerator, e.g. "CmdOrCtrl+Shift+P". */
const ACCELERATOR_KEYS: Record<string, string> = {
  Enter: 'Enter',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

export function accelerator(binding: KeyBinding): string {
  const key = ACCELERATOR_KEYS[binding.code] ?? keyLabel(binding.code, false)
  return [binding.mod && 'CmdOrCtrl', binding.alt && 'Alt', binding.shift && 'Shift', key].filter(Boolean).join('+')
}

/** The shortcut each command currently has. */
export function defaultBindings(): Map<string, KeyBinding> {
  const out = new Map<string, KeyBinding>()
  for (const c of COMMANDS as readonly Command[]) {
    const binding = c.key ? parseKey(c.key) : null
    if (binding) out.set(c.id, binding)
  }
  return out
}

/** Finds the command a key press is bound to. */
export function commandForKey(bindings: Map<string, KeyBinding>, e: KeyEventLike, mac: boolean): string | undefined {
  return commandsForKey(bindings, e, mac)[0]
}

/**
 * Every command a key press is bound to. Someone may give two commands the same shortcut on purpose, e.g.
 * one that only works in a run and one that works elsewhere; whichever can run at the time does.
 */
export function commandsForKey(bindings: Map<string, KeyBinding>, e: KeyEventLike, mac: boolean): string[] {
  return [...bindings].filter(([, binding]) => matches(binding, e, mac)).map(([id]) => id)
}
