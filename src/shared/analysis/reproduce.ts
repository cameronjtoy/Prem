// Reproducing an analysis: the exact environment it ran in, the files it read, and whether a rerun gives the
// same outputs.
//
// When a cell runs in the vault's environment, Prem saves that environment's full package list next to the
// note as `attachments/environment-<id>.txt` (pip's requirements format, so it also works with plain pip).
// The output records `env=<id>`, so the list can always be found again, even years later on another
// computer. Reproduce rebuilds that exact environment, reruns the cells, and compares what comes out.

import type { EnvironmentStamp } from './environment'
import { outputFiles, parseOutputBody, type OutputMeta } from './cells'
import type { CellResult } from './results'

export function lockFileName(environmentId: string): string {
  return `environment-${environmentId}.txt`
}

/** The saved package list for an environment: a comment header, then `pip freeze` lines. */
export function formatLock(stamp: EnvironmentStamp): string {
  return [
    `# Python environment ${stamp.id}, saved by Prem when a cell in this folder ran.`,
    `# Reproduce in Prem rebuilds exactly this; with plain pip: pip install -r ${lockFileName(stamp.id)}`,
    `# python==${stamp.pythonVersion}`,
    `# built with ${stamp.tool} on ${stamp.created}`,
    stamp.packages.trim(),
    ''
  ].join('\n')
}

export interface Lock {
  /** The Python version it was built with, if recorded. */
  python: string | null
  /** The package lines, ready for `pip install -r`. */
  requirements: string
}

export function parseLock(text: string): Lock {
  const python = /^#\s*python==(\S+)/m.exec(text)?.[1] ?? null
  const requirements = text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'))
    .join('\n')
  return { python, requirements: requirements ? requirements + '\n' : '' }
}

/** The files an output read that have changed or gone since it ran. `current` maps vault paths to their sha256. */
export function changedInputs(
  meta: OutputMeta,
  current: Record<string, string | null>
): { path: string; state: 'changed' | 'missing' }[] {
  const found: { path: string; state: 'changed' | 'missing' }[] = []
  for (const input of meta.inputs) {
    if (!(input.path in current) || !input.sha256) continue
    const now = current[input.path]
    if (now === null) found.push({ path: input.path, state: 'missing' })
    else if (!now.startsWith(input.sha256)) found.push({ path: input.path, state: 'changed' })
  }
  return found
}

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** "plate.csv changed since this output", for a cell's status line. */
export function describeChangedInputs(changed: { path: string; state: 'changed' | 'missing' }[]): string {
  if (!changed.length) return ''
  const names = (state: 'changed' | 'missing'): string =>
    changed
      .filter((c) => c.state === state)
      .map((c) => fileName(c.path))
      .join(', ')
  const parts = []
  if (names('changed')) parts.push(`${names('changed')} changed`)
  const missing = changed.filter((c) => c.state === 'missing').length
  if (missing) parts.push(`${names('missing')} ${missing > 1 ? 'are' : 'is'} gone`)
  return `${parts.join('; ')} since this output. Run it again, or Reproduce to compare.`
}

export type Verdict = 'same' | 'different' | 'failed'

export interface CellComparison {
  verdict: Verdict
  /** One line per part that was checked, e.g. "Printed text: same", "Figure 1: different". */
  details: { label: string; same: boolean }[]
  /** Files the rerun read whose contents differ from the original run's. */
  inputs: string[]
}

/** The checkable parts of an output, in order: text and files, ignoring notes like "No output." */
type Part = { kind: 'text'; label: string; text: string } | { kind: 'file'; label: string; data: Uint8Array | null }

const trimEnd = (text: string): string => text.replace(/\s+$/, '')

function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Compares a rerun of a cell with the output recorded in the note. `recordedBlock` is the output block;
 * `recordedFile(url)` returns the bytes of a file it links to (a figure or table), or null if it's gone.
 */
export function compareOutput(
  recordedBlock: string,
  recordedMeta: OutputMeta | null,
  recordedFile: (url: string) => Uint8Array | null,
  rerun: CellResult,
  hash: string
): CellComparison {
  const labels = { stdout: 'Printed text', stderr: 'Warnings', error: 'Error' } as const
  const before: Part[] = []
  for (const part of parseOutputBody(recordedBlock)) {
    if (part.kind === 'text') before.push({ kind: 'text', label: labels[part.stream], text: part.text })
    else if (part.kind === 'file') before.push({ kind: 'file', label: part.label, data: recordedFile(part.url) })
  }
  const after: Part[] = []
  const files = outputFiles(rerun.outputs, hash)
  let file = 0
  for (const o of rerun.outputs) {
    if (o.kind === 'text') after.push({ kind: 'text', label: labels[o.stream], text: o.text })
    else if (o.kind === 'result') after.push({ kind: 'text', label: labels.stdout, text: o.text })
    else if (o.kind === 'error')
      after.push({ kind: 'text', label: labels.error, text: o.traceback || `${o.name}: ${o.message}` })
    else after.push({ kind: 'file', label: files[file].label, data: files[file++].data })
  }

  const details: { label: string; same: boolean }[] = []
  const count = Math.max(before.length, after.length)
  for (let i = 0; i < count; i++) {
    const a = before[i]
    const b = after[i]
    const label = (a ?? b)!.label.replace(/^Table: .*/, 'Table')
    if (!a || !b || a.kind !== b.kind) {
      details.push({ label: a ? `${label} (missing from the rerun)` : `${label} (new in the rerun)`, same: false })
    } else if (a.kind === 'text' && b.kind === 'text') {
      details.push({ label, same: trimEnd(a.text) === trimEnd(b.text) })
    } else if (a.kind === 'file' && b.kind === 'file') {
      details.push({
        label: a.data ? label : `${label} (the saved file is gone)`,
        same: !!a.data && !!b.data && equalBytes(a.data, b.data)
      })
    }
  }

  const recordedInputs = new Map((recordedMeta?.inputs ?? []).map((i) => [i.path, i.sha256]))
  const inputs = rerun.inputs
    .filter((i) => recordedInputs.has(i.path) && !i.sha256.startsWith(recordedInputs.get(i.path)!))
    .map((i) => i.path)

  const verdict: Verdict =
    !rerun.ok && recordedMeta?.ok !== false ? 'failed' : details.every((d) => d.same) ? 'same' : 'different'
  return { verdict, details, inputs }
}

/** How the environment for a reproduction compares with the one recorded. */
export interface EnvironmentReport {
  /** The environment the outputs recorded, if any. */
  recorded: string | null
  /** The environment the rerun used. */
  used: string | null
  /** True when the rerun's environment is the recorded one, package for package. */
  exact: boolean
  /** In words, for the top of the report. */
  summary: string
}

export interface Reproduction {
  environment: EnvironmentReport
  /** One result per cell that was rerun, in order. */
  results: CellResult[]
}
