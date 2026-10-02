// What running one cell produces, as the runner reports it.

export type CellOutput =
  | { kind: 'text'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'result'; text: string }
  | { kind: 'error'; name: string; message: string; traceback: string }
  | { kind: 'image'; mime: 'image/png'; data: string }
  | { kind: 'table'; csv: string; rows: number; columns: number; truncated: boolean }

/** A file the code read, relative to the vault, with its sha256 at the time. */
export interface CellInput {
  path: string
  sha256: string
}

export interface CellResult {
  ok: boolean
  outputs: CellOutput[]
  inputs: CellInput[]
  /** Seconds. */
  duration: number
  /** When it ran, ISO 8601. */
  ranAt: string
  pythonVersion: string
  /** The environment it ran in (`EnvironmentStamp.id`), or null for a bare Python. */
  environment: string | null
}
