import type { VaultPath } from './types'

/** Hidden folder in each vault that holds note history. Dot folders are never listed or watched. */
export const PREM_FOLDER = '.prem'

export type HistoryKind = 'save' | 'external' | 'renamed' | 'deleted' | 'signed' | 'witnessed' | 'amended'

/**
 * One line of a note's append-only history log. Each entry's `id` is a hash of its other fields,
 * including `prev` (the previous entry's id), so the log forms a chain: changing, removing or
 * reordering any past entry breaks every id after it.
 */
export interface HistoryEntry {
  /** 1 for the note's first entry, counting up. */
  n: number
  /** ISO timestamp. */
  time: string
  /** Who made the change. Empty for edits made outside Prem. */
  author: string
  kind: HistoryKind
  /** SHA-256 of the note's content after this change. Empty for deletions. */
  hash: string
  size: number
  /** For renames: where the note was before. */
  from?: VaultPath
  /** For amendments, why a signed note was changed. For signatures, an optional statement. */
  reason?: string
  prev: string
  id: string
}

/** Versions saved within this long of each other are shown as one editing session. */
export const SESSION_GAP_MS = 10 * 60 * 1000

/** Groups entries into editing sessions (same author, no long pause), newest first. The last entry of each is the one to show. */
export function groupSessions(entries: HistoryEntry[]): HistoryEntry[][] {
  const sessions: HistoryEntry[][] = []
  for (const e of entries) {
    const current = sessions[sessions.length - 1]
    const last = current?.[current.length - 1]
    const joins =
      last &&
      last.kind === 'save' &&
      e.kind === 'save' &&
      last.author === e.author &&
      Date.parse(e.time) - Date.parse(last.time) < SESSION_GAP_MS
    if (joins) current.push(e)
    else sessions.push([e])
  }
  return sessions.reverse()
}
