// What Prem asks before running analysis code, and what it shows when it asks.
//
// Installing an environment runs code (pip packages can run anything while installing), and so does running a
// cell. Both can come from someone else: a teammate on a team vault, or anyone who can write to a synced or
// shared folder. So Prem runs only what this computer has approved: environment lists by their sha256, and
// cell code either typed here or approved before. Approvals live outside the vault, so they can't be forged
// by editing a note.

/** An environment list that would be installed but hasn't been approved on this computer. */
export interface EnvironmentApproval {
  /** The file it comes from, e.g. `environment.txt` or `Notebook/attachments/environment-9b1e2c3d4f5a.txt`. */
  file: string
  /** sha256 of the list, which is what gets approved. */
  hash: string
  /** The list itself. */
  text: string
  /** The list approved last time for this vault, to show what changed, or null if none was. */
  previous: string | null
  /** Who changed the file last: a name, '' for a change made outside Prem, or null if unknown. */
  changedBy: string | null
}

/** What needs approving before some cells can run. */
export interface RunCheck {
  environment: EnvironmentApproval | null
  /** Indexes into the codes that were checked, of the ones not approved on this computer. */
  code: number[]
}

/** What to approve: an environment list by its hash, and cell code by its text. */
export interface Approval {
  environment?: string
  code?: string[]
}

/** The package lines of a requirements list, without comments, blank lines or surrounding space. */
export function requirementLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|\s)#.*$/, '').trim())
    .filter(Boolean)
}

/** Lines added and removed since the list approved last time. */
export function diffRequirements(previous: string | null, next: string): { added: string[]; removed: string[] } {
  const before = new Set(requirementLines(previous ?? ''))
  const after = new Set(requirementLines(next))
  return {
    added: [...after].filter((l) => !before.has(l)),
    removed: [...before].filter((l) => !after.has(l))
  }
}

/**
 * Why a requirements line deserves a closer look, or null for a plain package name. Lines that fetch from
 * somewhere other than the package index, or change where packages come from, can install anything.
 */
export function riskyLine(line: string): string | null {
  const l = line.trim()
  if (/^(-i|--index-url|--extra-index-url|-f|--find-links|--trusted-host)\b/.test(l))
    return 'changes where packages are downloaded from'
  if (/^(-e|--editable)\b/.test(l)) return 'installs from a folder or repository'
  if (/^(-r|--requirement|-c|--constraint)\b/.test(l)) return 'includes another file'
  if (l.startsWith('-')) return 'an installer option'
  if (/^[./~\\]|^[a-zA-Z]:[\\/]/.test(l) || /(^|@\s*)file:/i.test(l)) return 'installs a file from this computer'
  if (/[a-z][a-z0-9+.-]*:\/\//i.test(l) || /^git\+/i.test(l)) return 'downloads from a web address'
  return null
}

/** The normalised form of a cell's code that approvals are kept for: trailing space doesn't matter. */
export function approvalText(code: string): string {
  return code.replace(/\s+$/, '')
}
