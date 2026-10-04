/** Vault-relative POSIX path, e.g. "Runbooks/Deploy.md". The vault root is "". */
export type VaultPath = string

export type EntryKind = 'file' | 'folder'

export interface VaultEntry {
  path: VaultPath
  kind: EntryKind
}

import type { AccessLevel } from './access'

export interface VaultInfo {
  name: string
  /** A folder path for a local vault, or the server address for a team vault. */
  root: string
  /** Who the team server knows you as. Only set for team vaults. */
  user?: string
  /** Your name as it appears on notebook entries and runs. */
  author?: string
  /** Your per-folder permissions on a team vault. Local vaults are fully writable. */
  access?: Record<string, AccessLevel>
  /** Your role on a team vault ("pi", "member" or "viewer"), if the server gives one. */
  role?: string
}

export interface FileRecord {
  path: VaultPath
  content: string
  version: string
}

export interface WriteOptions {
  /** Reject the write with a CONFLICT error if the file on disk no longer has this version. */
  expectedVersion?: string
  /** Reject the write with an EXISTS error if the file is already there. */
  createOnly?: boolean
  /** Who's saving, for the note's history. Set by whoever authenticated the user, never taken from a client. */
  author?: string
  /** Required to change a signed note: why it's being amended. The save is recorded as an amendment. */
  amendReason?: string
}

export interface WriteResult {
  version: string
}

export type VaultChange =
  | { type: 'created' | 'modified'; path: VaultPath; kind: EntryKind }
  | { type: 'deleted'; path: VaultPath; kind: EntryKind }

export interface ParsedLink {
  target: string
  heading?: string
  alias?: string
  embed: boolean
  from: number
  to: number
  line: number
}

export interface Backlink {
  source: VaultPath
  snippets: string[]
}

export interface OutgoingLink {
  target: string
  resolved: VaultPath | null
}

export interface GraphNode {
  id: string
  name: string
  resolved: boolean
  degree: number
}

export interface GraphLink {
  source: string
  target: string
}

export interface LinkIndexSnapshot {
  version: number
  backlinks: Record<VaultPath, Backlink[]>
  outgoing: Record<VaultPath, OutgoingLink[]>
  graph: { nodes: GraphNode[]; links: GraphLink[] }
  /** Every workflow in the vault, for the board's columns. */
  workflows: WorkflowSummary[]
  /** Every job in the vault, for the board and My tasks. */
  jobs: JobSummary[]
}

export interface WorkflowSummary {
  path: VaultPath
  title: string
  /** Stage names, in order. */
  stages: string[]
}

export interface JobSummary {
  path: VaultPath
  title: string
  /** The workflow it follows, as a link target, or null. */
  workflow: string | null
  /** The stage it's at (from its frontmatter). */
  stage: string
  /** The job's own copy of its stages, in order, with each one's default assignee. */
  stages: { name: string; assignee: string }[]
  assignee: string
  status: 'open' | 'in progress' | 'done'
  /** A run was started for the current stage and isn't complete yet. */
  runOpen: boolean
  /** How many samples it lists. */
  samples: number
  created: string
  finished: string
}

export interface TemplateInfo {
  name: string
  path: VaultPath
}

export interface AddedAttachment {
  path: VaultPath
  /** Markdown to insert in the note: an embed for images and tables, a link for other files. */
  markdown: string
}

export interface CreatedNote {
  path: VaultPath
  /** Offset where the cursor should be placed, from a {{cursor}} marker. */
  cursor: number | null
}

/** What happened to links elsewhere in the vault when something was renamed or moved. */
export interface RenameResult {
  /** Notes whose links were rewritten to follow the move. */
  updated: VaultPath[]
  /** Signed notes that link to what moved; they're locked, so their links weren't changed. */
  locked: VaultPath[]
  /** Notes you can read but not edit that link to what moved; their links weren't changed. */
  readOnly: VaultPath[]
}
