import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { LinkIndexSnapshot } from '@shared/types'
import { vaultClient } from '../services/vaultClient'
import { useVault } from './VaultContext'

const LinkIndexContext = createContext<LinkIndexSnapshot | null>(null)

export function LinkIndexProvider({ children }: { children: ReactNode }) {
  const { info } = useVault()
  const [snapshot, setSnapshot] = useState<LinkIndexSnapshot | null>(null)

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

export function useLinkIndex(): LinkIndexSnapshot | null {
  return useContext(LinkIndexContext)
}
