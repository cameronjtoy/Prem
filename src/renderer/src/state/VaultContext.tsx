import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Access } from '@shared/access'
import { isInside, isMarkdown, isTemplate, noteTitle } from '@shared/paths'
import { createResolver, type Resolver } from '@shared/resolve'
import type { VaultChange, VaultEntry, VaultInfo } from '@shared/types'
import { errorMessage, vaultClient } from '../services/vaultClient'

type ChangeListener = (changes: VaultChange[]) => void

interface VaultState {
  info: VaultInfo | null
  entries: VaultEntry[]
  starting: boolean
  error: string | null
  resolver: Resolver
  noteTitles: string[]
  /** Whether you may change this path. Always true for local vaults; team vaults follow your folder permissions. */
  canWrite(path: string): boolean
  openVault(): Promise<void>
  connectServer(url: string, token: string): Promise<void>
  refresh(): Promise<void>
  subscribe(listener: ChangeListener): () => void
}

const VaultContext = createContext<VaultState | null>(null)

function applyChanges(entries: VaultEntry[], changes: VaultChange[]): VaultEntry[] {
  const byPath = new Map(entries.map((e) => [e.path, e]))
  for (const c of changes) {
    if (c.type === 'deleted') {
      for (const p of [...byPath.keys()]) if (isInside(p, c.path)) byPath.delete(p)
    } else if (!byPath.has(c.path)) {
      byPath.set(c.path, { path: c.path, kind: c.kind })
    }
  }
  return [...byPath.values()]
}

export function VaultProvider({ children }: { children: ReactNode }) {
  const [info, setInfo] = useState<VaultInfo | null>(null)
  const [entries, setEntries] = useState<VaultEntry[]>([])
  const [starting, setStarting] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const listeners = useRef(new Set<ChangeListener>())

  const load = useCallback(async (next: VaultInfo | null) => {
    if (!next) return
    setEntries(await vaultClient.list())
    setInfo(next)
    setError(null)
  }, [])

  useEffect(() => {
    vaultClient
      .openLast()
      .then(load)
      .catch((err) => setError(errorMessage(err)))
      .finally(() => setStarting(false))
  }, [load])

  useEffect(() => {
    if (!info) return
    return vaultClient.onChanged((changes) => {
      setEntries((prev) => applyChanges(prev, changes))
      for (const l of listeners.current) l(changes)
    })
  }, [info])

  const openVault = useCallback(async () => {
    try {
      await load(await vaultClient.pickAndOpen())
    } catch (err) {
      setError(errorMessage(err))
    }
  }, [load])

  const connectServer = useCallback(
    async (url: string, token: string) => {
      try {
        await load(await vaultClient.connect(url, token))
      } catch (err) {
        setError(errorMessage(err))
      }
    },
    [load]
  )

  const refresh = useCallback(async () => {
    if (info) setEntries(await vaultClient.list())
  }, [info])

  const subscribe = useCallback((listener: ChangeListener) => {
    listeners.current.add(listener)
    return () => void listeners.current.delete(listener)
  }, [])

  const notePaths = useMemo(
    () => entries.filter((e) => e.kind === 'file' && isMarkdown(e.path)).map((e) => e.path),
    [entries]
  )
  const resolver = useMemo(() => createResolver(notePaths), [notePaths])
  const noteTitles = useMemo(
    () => [...new Set(notePaths.filter((p) => !isTemplate(p)).map(noteTitle))].sort((a, b) => a.localeCompare(b)),
    [notePaths]
  )

  const canWrite = useMemo(() => {
    if (!info?.access) return () => true
    const access = new Access(info.access)
    return (path: string) => access.canWrite(path)
  }, [info])

  const value = useMemo(
    () => ({ info, entries, starting, error, resolver, noteTitles, canWrite, openVault, connectServer, refresh, subscribe }),
    [info, entries, starting, error, resolver, noteTitles, canWrite, openVault, connectServer, refresh, subscribe]
  )
  return <VaultContext.Provider value={value}>{children}</VaultContext.Provider>
}

export function useVault(): VaultState {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used inside <VaultProvider>')
  return ctx
}
