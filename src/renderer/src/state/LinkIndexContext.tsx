import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { IndexSummary, LinkIndexSnapshot, NoteLinks, SampleIndex } from '@shared/vault/types'
import { vaultClient } from '../services/vaultClient'
import { useVault } from './VaultContext'

const LinkIndexContext = createContext<IndexSummary | null>(null)

export function LinkIndexProvider({ children }: { children: ReactNode }) {
  const { info } = useVault()
  const [snapshot, setSnapshot] = useState<IndexSummary | null>(null)

  useEffect(() => {
    setSnapshot(null)
    if (!info) return
    let active = true
    const unsubscribe = vaultClient.onIndexUpdated((s) => active && setSnapshot(s))
    vaultClient
      .getIndex()
      .then((s) => active && setSnapshot((prev) => (prev && s && prev.version >= s.version ? prev : s)))
      .catch(console.error)
    return () => {
      active = false
      unsubscribe()
    }
  }, [info])

  return <LinkIndexContext.Provider value={snapshot}>{children}</LinkIndexContext.Provider>
}

export function useLinkIndex(): IndexSummary | null {
  return useContext(LinkIndexContext)
}

/**
 * Fetches something from the index again whenever it changes, keeping the last value while the next one loads.
 * Big vaults have megabytes of links, so each view asks only for what it shows.
 */
function useIndexed<T>(load: (() => Promise<T | null>) | null, key: string): T | null {
  const summary = useLinkIndex()
  const [value, setValue] = useState<{ key: string; data: T | null } | null>(null)
  const version = summary?.version
  useEffect(() => {
    if (!load || version === undefined) return
    let current = true
    load()
      .then((data) => current && setValue({ key, data }))
      .catch(console.error)
    return () => {
      current = false
    }
    // `load` is recreated each render; `key` and the index version say when to fetch again.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [key, version])
  return value?.key === key ? value.data : null
}

/** The links into and out of one note. */
export function useNoteLinks(path: string | null | undefined): NoteLinks | null {
  return useIndexed(path ? () => vaultClient.noteLinks(path) : null, path ?? '')
}

/** Every note and link, for the graph view. */
export function useLinkGraph(): LinkIndexSnapshot['graph'] | null {
  return useIndexed(() => vaultClient.linkGraph(), 'graph')
}

/** Every sample and box, for the Samples view. */
export function useSampleIndex(): SampleIndex | null {
  return useIndexed(() => vaultClient.sampleIndex(), 'samples')
}
