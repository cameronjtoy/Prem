import { parseFrontmatter, setFrontmatterField } from './frontmatter'
import { joinPath, noteTitle, sanitizeFileName } from './paths'
import { formatDate } from './templates'
import type { VaultPath } from './types'

/** Sections copied from a protocol into each run, so the run records exactly what was followed. */
const COPIED_SECTIONS = ['Materials', 'Steps']
const TASK = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/
const STAMP = /\s+✓ (?:\d{4}-\d{2}-\d{2} )?\d{2}:\d{2}$/

export function isProtocol(text: string): boolean {
  return parseFrontmatter(text).fields.type === 'protocol'
}

export function isRun(text: string): boolean {
  return parseFrontmatter(text).fields.type === 'run'
}

/** Where a run is filed: in the operator's notebook, by year. */
export function runPath(notebookFolder: VaultPath, protocolPath: VaultPath, now: Date): VaultPath {
  const name = sanitizeFileName(`${noteTitle(protocolPath)} run ${formatDate(now, 'YYYY-MM-DD HHmm')}`)
  return joinPath(joinPath(joinPath(notebookFolder, 'Runs'), formatDate(now, 'YYYY')), `${name}.md`)
}

/** The `## Heading` sections of a markdown body, in order, with their full text. */
function sections(body: string): { heading: string; text: string }[] {
  const parts = body.split(/^(?=## )/m)
  return parts
    .filter((p) => p.startsWith('## '))
    .map((p) => ({ heading: p.slice(3, p.indexOf('\n') < 0 ? undefined : p.indexOf('\n')).trim(), text: p.trimEnd() }))
}

/** Unticks every task and removes old completion times, so a copied checklist starts fresh. */
function resetTasks(text: string): string {
  return text
    .split('\n')
    .map((line) => (TASK.test(line) ? line.replace(TASK, '$1[ ]').replace(STAMP, '') : line))
    .join('\n')
}

/** The content of a new run of a protocol: a snapshot of its materials and steps, plus places to record what happened. */
export function createRun(
  protocolPath: VaultPath,
  protocolText: string,
  options: { now: Date; operator: string }
): string {
  const { fields, end } = parseFrontmatter(protocolText)
  const body = protocolText.slice(end)
  const copied = sections(body).filter((s) => COPIED_SECTIONS.includes(s.heading))
  const steps = copied.length
    ? copied.map((s) => resetTasks(s.text)).join('\n\n')
    : `## Steps\n${resetTasks(body.trim())}`
  const title = noteTitle(protocolPath)
  const started = formatDate(options.now, 'YYYY-MM-DD HH:mm')
  return `---
type: run
protocol: "[[${title}]]"
protocol-version: ${fields.version ?? ''}
operator: ${options.operator}
started: ${started}
finished:
status: in progress
tags: [run]
---

# ${title} — run ${started}

Following [[${title}]]. Tick each step as you finish it; the time is recorded next to it.

${steps}

## Deviations
- None

## Results

## Samples used
- [[ ]]
`
}

/**
 * The new text of a task line when its checkbox is toggled in a run: ticking adds the time
 * (with the date too if the run started on another day), unticking removes it.
 */
export function toggleRunTask(line: string, check: boolean, now: Date, startedDay: string): string {
  const m = TASK.exec(line)
  if (!m) return line
  const unstamped = line.replace(STAMP, '')
  const ticked = unstamped.replace(TASK, `$1[${check ? 'x' : ' '}]`)
  if (!check) return ticked
  const day = formatDate(now, 'YYYY-MM-DD')
  const time = formatDate(now, day === startedDay ? 'HH:mm' : 'YYYY-MM-DD HH:mm')
  return `${ticked.trimEnd()} ✓ ${time}`
}

/** How many of the run's checklist steps are done. */
export function runProgress(text: string): { done: number; total: number } {
  let done = 0
  let total = 0
  for (const line of text.slice(parseFrontmatter(text).end).split('\n')) {
    const m = TASK.exec(line)
    if (!m) continue
    total++
    if (m[2] !== ' ') done++
  }
  return { done, total }
}

export function completeRun(text: string, now: Date): string {
  const finished = formatDate(now, 'YYYY-MM-DD HH:mm')
  return setFrontmatterField(setFrontmatterField(text, 'status', 'complete'), 'finished', finished)
}

/**
 * Adds a timestamped bullet under "## Deviations" (replacing the "None" placeholder), adding the
 * section if it's missing. Returns the new text and where the cursor should go to type the details.
 */
export function addDeviation(text: string, now: Date): { text: string; cursor: number } {
  const bullet = `- ${formatDate(now, 'HH:mm')} — `
  const heading = /^## Deviations[ \t]*$/m.exec(text)
  if (!heading) {
    const base = text.endsWith('\n') ? text : text + '\n'
    const next = `${base}\n## Deviations\n${bullet}\n`
    return { text: next, cursor: next.length - 1 }
  }
  const sectionStart = heading.index + heading[0].length
  const nextHeading = /^## /m.exec(text.slice(sectionStart + 1))
  const sectionEnd = nextHeading ? sectionStart + 1 + nextHeading.index : text.length
  let section = text.slice(sectionStart, sectionEnd)
  section = section.replace(/\n- None[ \t]*(?=\n|$)/, '')
  const body = section.replace(/\s+$/, '')
  const insertAt = sectionStart + body.length
  const next = text.slice(0, sectionStart) + body + '\n' + bullet + '\n\n' + text.slice(sectionEnd).replace(/^\n+/, '')
  return { text: next, cursor: insertAt + 1 + bullet.length }
}
