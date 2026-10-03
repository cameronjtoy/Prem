import { parseFrontmatter, setFrontmatterField } from '../notes/frontmatter'
import { column, findSection, formatTable, parseTable } from '../notes/tables'
import { formatDate } from '../notes/templates'
import { splitLinkText } from '../notes/wikilinks'
import { joinPath, noteTitle, sanitizeFileName } from '../vault/paths'
import type { VaultPath } from '../vault/types'

// A workflow is a lab process made of stages, each optionally run from a protocol. A job is one pass
// through a workflow: it copies the workflow's stages, tracks which one it's at and who has it, and
// logs the run each stage produced. Both are plain markdown notes; the structured parts are tables.

export interface Stage {
  name: string
  /** The protocol's link target, or null for a stage done without a protocol. */
  protocol: string | null
  assignee: string
  outputs: string
}

export interface LogRow {
  stage: string
  /** The run's link target, or null for a stage completed without a run. */
  run: string | null
  by: string
  started: string
  completed: string
}

export type JobStatus = 'open' | 'in progress' | 'done'

export interface JobState {
  stages: Stage[]
  /** The current stage's position in `stages`, or -1 when the job is done or its stage isn't listed. */
  index: number
  current: Stage | null
  log: LogRow[]
  status: JobStatus
  /** The log row of a run started for the current stage and not yet completed. */
  openRow: LogRow | null
}

export const STAGES_HEADING = 'Stages'
export const LOG_HEADING = 'Stage log'
const LOG_HEADER = ['Stage', 'Run', 'By', 'Started', 'Completed']
const JOBS_FOLDER = 'Jobs'

export function isWorkflow(text: string): boolean {
  return parseFrontmatter(text).fields.type === 'workflow'
}

export function isJob(text: string): boolean {
  return parseFrontmatter(text).fields.type === 'job'
}

/** The target of the first `[[link]]` in a cell or field, or null. */
export function linkTarget(value: string | undefined): string | null {
  const m = /\[\[([^\]]+)\]\]/.exec(value ?? '')
  const target = m ? splitLinkText(m[1]).target : ''
  return target || null
}

const link = (target: string | null): string => (target ? `[[${target}]]` : '')

/** The table under a `## Heading`, or null if the section or its table is missing. */
function sectionTable(text: string, heading: string) {
  const section = findSection(text, heading)
  if (!section) return null
  const table = parseTable(text.slice(0, section.to), section.from)
  return table ? { section, table } : null
}

/** The stages listed in a workflow's (or a job's) Stages table, skipping rows without a name. */
export function parseStages(text: string): Stage[] {
  const found = sectionTable(text, STAGES_HEADING)
  if (!found) return []
  const { table } = found
  const at = (row: string[], name: string): string => row[column(table, name)] ?? ''
  return table.rows
    .map((row) => ({
      name: at(row, 'Stage'),
      protocol: linkTarget(at(row, 'Protocol')),
      assignee: at(row, 'Assignee'),
      outputs: at(row, 'Outputs')
    }))
    .filter((s) => s.name)
}

/** Where a new job of a workflow is filed: `Jobs/<workflow>/`, named by when it was created. */
export function jobPath(workflowPath: VaultPath, now: Date): VaultPath {
  const title = sanitizeFileName(noteTitle(workflowPath))
  const name = sanitizeFileName(`${title} job ${formatDate(now, 'YYYY-MM-DD HHmm')}`)
  return joinPath(joinPath(JOBS_FOLDER, title), `${name}.md`)
}

/** The text of a job: at the first of `stages`, with its own copy of the Stages table. */
function jobText(options: {
  title: string
  version: string
  stagesTable: string
  first: Stage
  samples: string
  now: Date
  author: string
  rerunOf?: string
}): string {
  const created = formatDate(options.now, 'YYYY-MM-DD HH:mm')
  const { title } = options
  const rerun = options.rerunOf ? `rerun-of: "[[${options.rerunOf}]]"\n` : ''
  const intro = options.rerunOf
    ? `Following [[${title}]] again, as a rerun of [[${options.rerunOf}]], with the same stages and samples.`
    : `Following [[${title}]]. Start each stage's run from the bar above; completing a stage hands the job to the next stage's assignee.`
  return `---
type: job
workflow: "[[${title}]]"
workflow-version: ${options.version}
stage: ${options.first.name}
assignee: ${options.first.assignee}
status: open
created: ${created}
created-by: ${options.author}
${rerun}finished:
tags: [job]
---

# ${title} — job ${created}

${intro}

## Samples
${options.samples.trim() || '- [[ ]]'}

## ${STAGES_HEADING}
${options.stagesTable}

## ${LOG_HEADING}
${formatTable(LOG_HEADER, [])}
## Notes
`
}

/** The content of a new job: at the workflow's first stage, with a copy of its stages so later edits don't change it. */
export function createJob(
  workflowPath: VaultPath,
  workflowText: string,
  options: { now: Date; author: string }
): string {
  const stages = parseStages(workflowText)
  if (!stages.length) throw new Error('This workflow has no stages yet. Add rows to its Stages table first.')
  const { fields } = parseFrontmatter(workflowText)
  const found = sectionTable(workflowText, STAGES_HEADING)!
  return jobText({
    title: noteTitle(workflowPath),
    version: fields.version ?? '',
    stagesTable: workflowText.slice(found.table.from, found.table.to).trimEnd(),
    first: stages[0],
    samples: '',
    ...options
  })
}

/** The workflow a job follows, by title, from its `workflow:` link. */
export function jobWorkflow(text: string): string | null {
  return linkTarget(parseFrontmatter(text).fields.workflow)
}

/**
 * A new job that runs a job again from its first stage: the same stages (from the job, not the workflow as
 * it is now, so it repeats exactly what was done) and the same samples, linked back to the original.
 */
export function rerunJob(originalPath: VaultPath, text: string, options: { now: Date; author: string }): string {
  const stages = parseStages(text)
  if (!stages.length) throw new Error("This job's Stages table is empty, so there's nothing to run again.")
  const { fields } = parseFrontmatter(text)
  const found = sectionTable(text, STAGES_HEADING)!
  const samples = findSection(text, 'Samples')
  return jobText({
    title: jobWorkflow(text) ?? noteTitle(originalPath),
    version: fields['workflow-version'] ?? '',
    stagesTable: text.slice(found.table.from, found.table.to).trimEnd(),
    first: stages[0],
    samples: samples ? text.slice(samples.from, samples.to) : '',
    rerunOf: noteTitle(originalPath),
    ...options
  })
}

/**
 * Sends a job back to an earlier (or the current) stage to do it again: the stage and its default assignee
 * become current, a finished job reopens, and a dated line in Notes says who sent it back and why. The stage
 * log keeps every earlier row, so the first attempt stays on record; the redo gets rows of its own.
 */
export function redoStage(text: string, stage: string, entry: { by: string; now: Date; reason: string }): string {
  const target = parseStages(text).find((s) => s.name === stage)
  if (!target) throw new Error(`"${stage}" isn't one of this job's stages.`)
  let next = setFrontmatterField(text, 'stage', target.name)
  next = setFrontmatterField(next, 'assignee', target.assignee)
  next = setFrontmatterField(next, 'status', 'in progress')
  next = setFrontmatterField(next, 'finished', '')
  const stamp = formatDate(entry.now, 'YYYY-MM-DD HH:mm')
  const line = `- ${stamp} — ${entry.by || 'Someone'} sent the job back to ${target.name}${entry.reason.trim() ? `: ${entry.reason.trim()}` : '.'}`
  const notes = findSection(next, 'Notes')
  if (!notes) return `${next.endsWith('\n') ? next : next + '\n'}\n## Notes\n${line}\n`
  const body = next.slice(notes.from, notes.to).replace(/\s+$/, '')
  const rest = next.slice(notes.to)
  return next.slice(0, notes.from) + (body ? `${body}\n` : '') + line + '\n' + (rest ? `\n${rest}` : '')
}

/** The stages a job can be sent back to: those it has reached so far (all of them once it's done). */
export function redoableStages(state: JobState): Stage[] {
  return state.status === 'done' ? state.stages : state.stages.slice(0, Math.max(state.index + 1, 0))
}

function readLog(text: string): LogRow[] {
  const found = sectionTable(text, LOG_HEADING)
  if (!found) return []
  const { table } = found
  const at = (row: string[], name: string): string => row[column(table, name)] ?? ''
  return table.rows.map((row) => ({
    stage: at(row, 'Stage'),
    run: linkTarget(at(row, 'Run')),
    by: at(row, 'By'),
    started: at(row, 'Started'),
    completed: at(row, 'Completed')
  }))
}

function asStatus(value: string | undefined): JobStatus {
  return value === 'done' || value === 'in progress' ? value : 'open'
}

export function jobState(text: string): JobState {
  const { fields } = parseFrontmatter(text)
  const stages = parseStages(text)
  const log = readLog(text)
  const status = asStatus(fields.status)
  const index = status === 'done' ? -1 : stages.findIndex((s) => s.name === fields.stage)
  const current = index >= 0 ? stages[index] : null
  const openRow = current ? (log.findLast((r) => r.stage === current.name && !r.completed) ?? null) : null
  return { stages, index, current, log, status, openRow }
}

/** Replaces the job's Stage log table with `rows`, adding the section if it's missing. */
function writeLog(text: string, rows: LogRow[]): string {
  const table = formatTable(
    LOG_HEADER,
    rows.map((r) => [r.stage, link(r.run), r.by, r.started, r.completed])
  )
  const found = sectionTable(text, LOG_HEADING)
  if (found) return text.slice(0, found.table.from) + table + text.slice(found.table.to)
  const section = findSection(text, LOG_HEADING)
  if (section) return text.slice(0, section.from) + table + text.slice(section.from)
  const base = text.endsWith('\n') ? text : text + '\n'
  return `${base}\n## ${LOG_HEADING}\n${table}`
}

/** Records that a run was started for a stage, and marks the job in progress. */
export function logRunStarted(text: string, entry: { stage: string; run: string; by: string; now: Date }): string {
  const row: LogRow = {
    stage: entry.stage,
    run: entry.run,
    by: entry.by,
    started: formatDate(entry.now, 'YYYY-MM-DD HH:mm'),
    completed: ''
  }
  return setFrontmatterField(writeLog(text, [...readLog(text), row]), 'status', 'in progress')
}

/**
 * Completes the job's current stage: closes its open log row (or logs it without a run), then hands
 * the job to the next stage and its assignee, or marks the job done after the last stage.
 */
export function completeStage(text: string, entry: { by: string; now: Date }): string {
  const state = jobState(text)
  if (!state.current) return text
  const stamp = formatDate(entry.now, 'YYYY-MM-DD HH:mm')
  const log = [...state.log]
  const open = state.openRow ? log.lastIndexOf(state.openRow) : -1
  if (open >= 0) log[open] = { ...log[open], completed: stamp, by: log[open].by || entry.by }
  else log.push({ stage: state.current.name, run: null, by: entry.by, started: stamp, completed: stamp })
  let next = writeLog(text, log)
  const following = state.stages[state.index + 1]
  if (following) {
    next = setFrontmatterField(next, 'stage', following.name)
    next = setFrontmatterField(next, 'assignee', following.assignee)
    return setFrontmatterField(next, 'status', 'in progress')
  }
  next = setFrontmatterField(next, 'status', 'done')
  return setFrontmatterField(next, 'finished', stamp)
}

/** Links a run back to the job and stage it was started for. */
export function tagRun(runText: string, jobTitle: string, stage: string): string {
  return setFrontmatterField(setFrontmatterField(runText, 'job', `"[[${jobTitle}]]"`), 'stage', stage)
}
