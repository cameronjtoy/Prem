import type { HistoryEntry } from './history'

export type RecordState =
  /** Never signed, or amended since, and not signed again. */
  | 'draft'
  | 'signed'
  | 'witnessed'
  /** Changed with a recorded reason after it was signed; needs signing again. */
  | 'amended'

/** Note types that are records someone signs off. Any note that's already been signed can be signed again too. */
export const SIGNABLE_TYPES: ReadonlySet<string> = new Set([
  'experiment',
  'run',
  'daily',
  'protocol',
  'workflow',
  'job'
])

export interface Signature {
  by: string
  at: string
  statement?: string
}

export interface RecordStatus {
  state: RecordState
  /** A locked note can't be edited, renamed or deleted; it can only be amended with a reason. */
  locked: boolean
  signature?: Signature
  witnesses: Signature[]
  /** Hash of the content that was signed. */
  signedHash?: string
  /** The reason given for the latest amendment, while the note is amended but not re-signed. */
  amendment?: Signature & { reason: string }
  /** The file was changed by something other than Prem after it was signed. */
  changedOutside: boolean
  /** How many times this note has been signed, including earlier signatures that were later amended. */
  timesSigned: number
}

export const EMPTY_STATUS: RecordStatus = {
  state: 'draft',
  locked: false,
  witnesses: [],
  changedOutside: false,
  timesSigned: 0
}

/**
 * Folds one history entry into a note's signing status. Walking a note's whole log through this
 * gives its current status; the same function keeps a cached status up to date as entries are added.
 */
export function applyEntry(status: RecordStatus, e: HistoryEntry): RecordStatus {
  switch (e.kind) {
    case 'signed':
      return {
        state: 'signed',
        locked: true,
        signature: { by: e.author, at: e.time, statement: e.reason },
        witnesses: [],
        signedHash: e.hash,
        changedOutside: false,
        timesSigned: status.timesSigned + 1
      }
    case 'witnessed':
      if (!status.locked) return status
      return { ...status, state: 'witnessed', witnesses: [...status.witnesses, { by: e.author, at: e.time }] }
    case 'amended':
      return {
        ...EMPTY_STATUS,
        state: 'amended',
        amendment: { by: e.author, at: e.time, reason: e.reason ?? '' },
        timesSigned: status.timesSigned
      }
    case 'save':
      // Only amendments may change a locked note; a plain save here means an older app wrote it.
      if (status.locked && e.hash !== status.signedHash) return { ...status, changedOutside: true }
      return status
    case 'external':
      if (status.locked && e.hash !== status.signedHash) return { ...status, changedOutside: true }
      if (status.locked && e.hash === status.signedHash) return { ...status, changedOutside: false }
      return status
    case 'deleted':
      return { ...EMPTY_STATUS, timesSigned: status.timesSigned }
    case 'renamed':
      return status
  }
}

export function recordStatus(entries: HistoryEntry[]): RecordStatus {
  return entries.reduce(applyEntry, EMPTY_STATUS)
}

/** Status as reported to the app: the signing state plus whether the note's history checks out. */
export interface RecordCheck extends RecordStatus {
  /** False if any past history entry was altered, removed or reordered. */
  chainOk: boolean
}
