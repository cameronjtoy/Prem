import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { resolveBindings, type KeybindingsSnapshot } from '@shared/keybindings'
import { setBindings } from '../commands/registry'
import { vaultClient } from '../services/vaultClient'

interface KeybindingsState {
  snapshot: KeybindingsSnapshot
  /** Gives a command a new shortcut, or none with null. Rejects with a message the person can read. */
  set(command: string, key: string | null): Promise<void>
  reset(command: string): Promise<void>
  openFile(): Promise<void>
}

const EMPTY: KeybindingsSnapshot = { entries: [], problems: [], error: null, file: '' }

const KeybindingsContext = createContext<KeybindingsState | null>(null)

/** Keeps the command registry's shortcuts in step with keybindings.json. Everything below re-renders on a change. */
export function KeybindingsProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<KeybindingsSnapshot>(EMPTY)

  const show = useCallback((next: KeybindingsSnapshot) => {
    setBindings(resolveBindings(next.entries))
    setSnapshot(next)
  }, [])

  useEffect(() => {
    const off = vaultClient.onKeybindingsChanged(show)
    void vaultClient.getKeybindings().then(show)
    return off
  }, [show])

  const value = useMemo<KeybindingsState>(
    () => ({
      snapshot,
      set: async (command, key) => show(await vaultClient.setKeybinding(command, key)),
      reset: async (command) => show(await vaultClient.resetKeybinding(command)),
      openFile: vaultClient.openKeybindingsFile
    }),
    [snapshot, show]
  )
  return <KeybindingsContext.Provider value={value}>{children}</KeybindingsContext.Provider>
}

export function useKeybindings(): KeybindingsState {
  const ctx = useContext(KeybindingsContext)
  if (!ctx) throw new Error('useKeybindings must be used inside KeybindingsProvider')
  return ctx
}
