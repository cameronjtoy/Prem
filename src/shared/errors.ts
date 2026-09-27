export type VaultErrorCode =
  | 'INVALID_PATH'
  | 'NOT_FOUND'
  | 'EXISTS'
  | 'CONFLICT'
  | 'NO_VAULT'
  | 'INVALID_ARGUMENT'
  | 'UNKNOWN'

export class VaultError extends Error {
  constructor(
    readonly code: VaultErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'VaultError'
  }
}

export interface SerializedError {
  code: VaultErrorCode
  message: string
}

/** Errors thrown by ipcMain handlers lose their fields, so results travel as values instead. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: SerializedError }

export function isVaultError(err: unknown, code?: VaultErrorCode): err is VaultError {
  return err instanceof VaultError && (code === undefined || err.code === code)
}
