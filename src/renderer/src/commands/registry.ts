import { useEffect, useRef } from 'react'
import {
  commandForKey,
  defaultBindings,
  formatKey,
  type CommandId,
  type KeyBinding,
  type KeyEventLike
} from '@shared/commands'

/**
 * What a command does right now. Components register handlers while they're on screen: the app shell
 * handles navigation, the open note handles formatting and signing. The most recently registered
 * handler for a command wins, so a modal can take over a command while it's open.
 */
interface Handler {
  run(): void
  /** Whether the command can run now; a command that can't is left to the editor or the system. */
  enabled?(): boolean
}

const handlers = new Map<string, Handler[]>()
const listeners = new Set<() => void>()

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform) || navigator.userAgent.includes('Mac OS')

let bindings: Map<string, KeyBinding> = defaultBindings()

export function currentBindings(): Map<string, KeyBinding> {
  return bindings
}

export function setBindings(next: Map<string, KeyBinding>): void {
  bindings = next
  for (const listener of listeners) listener()
}

export function onCommandsChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function registerCommand(id: CommandId, handler: Handler): () => void {
  const list = handlers.get(id) ?? []
  list.push(handler)
  handlers.set(id, list)
  for (const listener of listeners) listener()
  return () => {
    const current = handlers.get(id)
    if (!current) return
    const i = current.lastIndexOf(handler)
    if (i >= 0) current.splice(i, 1)
    for (const listener of listeners) listener()
  }
}

function activeHandler(id: string): Handler | undefined {
  const list = handlers.get(id)
  const handler = list?.[list.length - 1]
  return handler && (handler.enabled?.() ?? true) ? handler : undefined
}

export function canRun(id: string): boolean {
  return !!activeHandler(id)
}

// The menu and the keyboard can both deliver the same shortcut; run it once.
let last: { id: string; at: number } | null = null

/** Runs a command if it can run now. Returns whether it ran. */
export function runCommand(id: string, source: 'key' | 'menu' | 'palette' = 'palette'): boolean {
  const handler = activeHandler(id)
  if (!handler) return false
  // macOS sends menu shortcuts even while typing in a dialog; only app-level commands apply there.
  if (source === 'menu' && document.activeElement?.closest('.modal') && !/^(app|help)\./.test(id)) return false
  const now = Date.now()
  if (source === 'menu' && last && last.id === id && now - last.at < 400) return true
  last = { id, at: now }
  handler.run()
  return true
}

/** Handles a key press: runs its command if it has one that can run, and stops the key going further. */
export function handleKeyDown(e: KeyboardEvent): void {
  if (e.defaultPrevented || e.isComposing) return
  const target = e.target instanceof Element ? e.target : null
  // While a dialog is open, its own keys apply; Esc closes it.
  if (target?.closest('.modal, .context-menu')) return
  const id = commandForKey(bindings, e as KeyEventLike, isMac)
  if (!id || !runCommand(id, 'key')) return
  e.preventDefault()
  e.stopPropagation()
}

/** Registers a handler for as long as the component is mounted, always calling its latest props. */
export function useCommand(id: CommandId, run: () => void, enabled: () => boolean = () => true): void {
  const latest = useRef({ run, enabled })
  latest.current = { run, enabled }
  useEffect(
    () => registerCommand(id, { run: () => latest.current.run(), enabled: () => latest.current.enabled() }),
    [id]
  )
}

/** The shortcut for a command as this platform writes it, e.g. "⌘K" or "Ctrl+K"; empty if it has none. */
export function keyFor(id: CommandId): string {
  const binding = bindings.get(id)
  return binding ? formatKey(binding, isMac) : ''
}
