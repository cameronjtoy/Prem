import type { SerializedError, VaultErrorCode } from './errors'
import type { AccessLevel } from './access'

/** The HTTP contract between a Prem team server and RemoteProvider. Paths travel in the query string. */
export const Routes = {
  health: '/api/health',
  info: '/api/info',
  entries: '/api/entries',
  file: '/api/file',
  blob: '/api/blob',
  history: '/api/history',
  version: '/api/history/version',
  files: '/api/files',
  exists: '/api/exists',
  folder: '/api/folder',
  rename: '/api/rename',
  events: '/api/events'
} as const

/** Identifies the connection a request came from, so a client isn't sent the echo of its own write. */
export const CLIENT_HEADER = 'x-prem-client'

export interface ServerInfo {
  name: string
  user: string
  access: Record<string, AccessLevel>
}

export interface ErrorBody {
  error: SerializedError
}

export const STATUS_BY_CODE: Record<VaultErrorCode, number> = {
  INVALID_PATH: 400,
  INVALID_ARGUMENT: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  EXISTS: 409,
  CONFLICT: 409,
  NO_VAULT: 503,
  UNAVAILABLE: 503,
  UNKNOWN: 500
}
