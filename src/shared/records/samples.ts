import { parseFrontmatter, setFrontmatterField } from '../notes/frontmatter'
import { column, findSection, formatTable, sectionTable } from '../notes/tables'
import { formatDate, renderTemplate } from '../notes/templates'
import { joinPath, noteTitle, sanitizeFileName } from '../vault/paths'
import type { BoxSummary, SampleSummary, VaultPath } from '../vault/types'

// Samples and where they are stored. A sample is a note with `type: sample` and a `location` such as
// "Freezer B, box 3, A1": the parts before the last are the container (freezer, then any racks or shelves,
// then the box), and the last is the well. A box can have a note of its own (`type: box`) giving its size;
// without one it is drawn 9 × 9, or bigger if a sample sits outside that.

export const SAMPLE_STATUSES = ['available', 'used up', 'discarded'] as const
export type SampleStatus = (typeof SAMPLE_STATUSES)[number]

/** A box's size when it has no note of its own: the common 81-place cryobox. */
export const DEFAULT_BOX = { rows: 9, columns: 9 }

const LOG_HEADING = 'Location log'
const LOG_HEADER = ['When', 'From', 'To', 'By']

export const isSample = (text: string): boolean => parseFrontmatter(text).fields.type === 'sample'
export const isBox = (text: string): boolean => parseFrontmatter(text).fields.type === 'box'

export interface Well {
  /** 0-based. */
  row: number
  column: number
}

/** "A" for the first row, "Z" for the 26th, then "AA". */
function rowName(row: number): string {
  let name = ''
  for (let n = row + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name
  return name
}

/** "A1" for the top-left well. */
export function wellName(well: Well): string {
  return `${rowName(well.row)}${well.column + 1}`
}

/** The well a name like "B7" or "b07" means, or null. */
export function parseWell(name: string): Well | null {
  const m = /^([A-Za-z]{1,2})0*([1-9]\d{0,2})$/.exec(name.trim())
  if (!m) return null
  const row = [...m[1].toUpperCase()].reduce((n, c) => n * 26 + (c.charCodeAt(0) - 64), 0) - 1
  return { row, column: Number(m[2]) - 1 }
}

export interface Location {
  /** The container's parts, outermost first: ["Freezer B", "box 3"]. Empty if no location is given. */
  container: string[]
  /** The well, if the last part is one. */
  well: Well | null
  /** Anything in brackets, such as "(glycerol stock)". */
  note: string
}

/** Reads "Freezer B, box 3, A1 (glycerol stock)". */
export function parseLocation(text: string): Location {
  const notes: string[] = []
  const bare = text.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    notes.push(inner.trim())
    return ''
  })
  const parts = bare
    .split(/[,/]/)
    .map((p) => p.trim())
    .filter(Boolean)
  const last = parts.length > 1 ? parseWell(parts[parts.length - 1]) : null
  return { container: last ? parts.slice(0, -1) : parts, well: last, note: notes.join('; ') }
}

/** Writes a location back as "Freezer B, box 3, A1". */
export function formatLocation(container: string[], well: Well | null, note = ''): string {
  const parts = well ? [...container, wellName(well)] : container
  return parts.join(', ') + (note ? ` (${note})` : '')
}

/** One container's name, for comparing: "Freezer B, Box 3" and "freezer b, box 3" are the same box. */
export const containerKey = (container: string[]): string => container.map((p) => p.toLowerCase()).join(', ')

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const asStatus = (value: string | undefined): SampleStatus =>
  (SAMPLE_STATUSES as readonly string[]).includes(value ?? '') ? (value as SampleStatus) : 'available'

/** A sample, as the Samples view needs it, without reading the note again. */
export function summarizeSample(path: VaultPath, text: string): SampleSummary {
  const { fields } = parseFrontmatter(text)
  const location = parseLocation(fields.location ?? '')
  return {
    path,
    title: noteTitle(path),
    id: fields.id || noteTitle(path),
    kind: fields['sample-type'] ?? '',
    location: fields.location ?? '',
    box: location.container.length ? location.container.join(', ') : null,
    well: location.well ? wellName(location.well) : null,
    status: asStatus(fields.status),
    created: fields.created ?? '',
    createdBy: fields['created-by'] ?? ''
  }
}

const size = (value: string | undefined, fallback: number): number => {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 && n <= 48 ? n : fallback
}

/** A box note: where it is and how many rows and columns of places it has. */
export function summarizeBox(path: VaultPath, text: string): BoxSummary {
  const { fields } = parseFrontmatter(text)
  return {
    path,
    location: parseLocation(fields.location || noteTitle(path)).container.join(', '),
    rows: size(fields.rows, DEFAULT_BOX.rows),
    columns: size(fields.columns, DEFAULT_BOX.columns)
  }
}

export interface StorageBox {
  /** "Freezer B, box 3". */
  location: string
  container: string[]
  /** The box's note, if it has one. */
  path: VaultPath | null
  rows: number
  columns: number
  /** Samples in each well, by well name. More than one means two samples claim the same place. */
  wells: Map<string, SampleSummary[]>
  /** Samples in the box with no well, or a well outside it. */
  unplaced: SampleSummary[]
}

/**
 * Every box, from box notes and from the locations samples give, with the samples in each well.
 * Samples that are used up or discarded no longer take a place.
 */
export function storageBoxes(boxes: BoxSummary[], samples: SampleSummary[]): StorageBox[] {
  const byKey = new Map<string, StorageBox>()
  const boxFor = (location: string): StorageBox => {
    const container = parseLocation(location).container
    const key = containerKey(container)
    let box = byKey.get(key)
    if (!box) {
      box = { location: container.join(', '), container, path: null, ...DEFAULT_BOX, wells: new Map(), unplaced: [] }
      byKey.set(key, box)
    }
    return box
  }
  for (const b of boxes) {
    if (!b.location) continue
    Object.assign(boxFor(b.location), { path: b.path, rows: b.rows, columns: b.columns })
  }
  const placed = samples.filter((s) => s.box && s.status === 'available')
  for (const s of placed) {
    const box = boxFor(s.box!)
    const well = s.well ? parseWell(s.well) : null
    // A box without a note grows to fit what's in it.
    if (well && !box.path) {
      box.rows = Math.max(box.rows, well.row + 1)
      box.columns = Math.max(box.columns, well.column + 1)
    }
  }
  for (const s of placed) {
    const box = byKey.get(containerKey(parseLocation(s.box!).container))!
    const well = s.well ? parseWell(s.well) : null
    if (!well || well.row >= box.rows || well.column >= box.columns) {
      box.unplaced.push(s)
      continue
    }
    const name = wellName(well)
    box.wells.set(name, [...(box.wells.get(name) ?? []), s])
  }
  return [...byKey.values()].sort((a, b) =>
    a.location.localeCompare(b.location, undefined, { numeric: true, sensitivity: 'base' })
  )
}

/** The freezers (the first part of every location), in order. */
export function freezers(boxes: StorageBox[]): string[] {
  const names = new Map<string, string>()
  for (const b of boxes) if (b.container.length) names.set(b.container[0].toLowerCase(), b.container[0])
  return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
}

/** Why a sample can't go to this place, or null if it can. */
export function placeRefusal(boxes: StorageBox[], location: string, samplePath: VaultPath | null): string | null {
  const parsed = parseLocation(location)
  if (!parsed.container.length) return 'Say where: a freezer and box, such as "Freezer A, box 1, B3".'
  if (!parsed.well) return null
  const box = boxes.find((b) => containerKey(b.container) === containerKey(parsed.container))
  if (!box) return null
  if (parsed.well.row >= box.rows || parsed.well.column >= box.columns) {
    return `${box.location} has ${box.rows} rows and ${box.columns} columns, so there's no ${wellName(parsed.well)}.`
  }
  const there = (box.wells.get(wellName(parsed.well)) ?? []).filter((s) => s.path !== samplePath)
  return there.length ? `${wellName(parsed.well)} in ${box.location} already holds ${there[0].id}.` : null
}

/**
 * The next free sample ID for a format such as "S-{####}" or "S-{YYYY}-{###}": the highest number already used
 * with the same fixed parts, plus one, padded to the number of #.
 */
export function nextSampleId(format: string, existing: string[], now: Date): string {
  const filled = format
    .replace(/\{YYYY\}/g, formatDate(now, 'YYYY'))
    .replace(/\{YY\}/g, formatDate(now, 'YYYY').slice(2))
    .replace(/\{MM\}/g, formatDate(now, 'MM'))
  const counter = /\{(#+)\}/.exec(filled)
  if (!counter) return filled
  const [before, after] = [filled.slice(0, counter.index), filled.slice(counter.index + counter[0].length)]
  const pattern = new RegExp(`^${escapeRegExp(before)}(\\d+)${escapeRegExp(after)}$`, 'i')
  let highest = 0
  for (const id of existing) {
    const m = pattern.exec(id.trim())
    if (m) highest = Math.max(highest, Number(m[1]))
  }
  return `${before}${String(highest + 1).padStart(counter[1].length, '0')}${after}`
}

/** Where a new sample note goes: `<folder>/<id>.md`. */
export const samplePath = (folder: string, id: string): VaultPath => joinPath(folder, `${sanitizeFileName(id)}.md`)

/** Used when the vault has no templates/Sample.md. */
export const SAMPLE_TEMPLATE_FALLBACK = `---
type: sample
id: {{title}}
sample-type:
location:
created: {{date}}
created-by: {{author}}
tags: [sample]
---

# {{title}}

## Description
{{cursor}}

## Notes
`

/** A sample note made from the Sample template, with its ID and place filled in. */
export function createSample(
  template: string,
  sample: { id: string; location: string; author: string; now: Date }
): string {
  let text = renderTemplate(template, { title: sample.id, now: sample.now, author: sample.author }).content
  if (!isSample(text)) text = setFrontmatterField(text, 'type', 'sample')
  text = setFrontmatterField(text, 'id', sample.id)
  if (sample.location) text = setFrontmatterField(text, 'location', sample.location)
  return text
}

export interface LogRow {
  when: string
  from: string
  to: string
  by: string
}

/** The moves recorded in a sample's Location log, oldest first. */
export function locationLog(text: string): LogRow[] {
  const found = sectionTable(text, LOG_HEADING)
  if (!found) return []
  const { table } = found
  const at = (row: string[], name: string): string => row[column(table, name)] ?? ''
  return table.rows.map((row) => ({
    when: at(row, 'When'),
    from: at(row, 'From'),
    to: at(row, 'To'),
    by: at(row, 'By')
  }))
}

function writeLog(text: string, rows: LogRow[]): string {
  const table = formatTable(
    LOG_HEADER,
    rows.map((r) => [r.when, r.from, r.to, r.by])
  )
  const found = sectionTable(text, LOG_HEADING)
  if (found) return text.slice(0, found.table.from) + table + text.slice(found.table.to)
  const section = findSection(text, LOG_HEADING)
  if (section) return text.slice(0, section.from) + table + text.slice(section.from)
  const base = text.endsWith('\n') ? text : text + '\n'
  return `${base}\n## ${LOG_HEADING}\n${table}`
}

/** Moves a sample: sets its `location` and adds a row to its Location log. */
export function moveSample(text: string, to: string, entry: { by: string; now: Date }): string {
  const from = parseFrontmatter(text).fields.location ?? ''
  if (from.trim() === to.trim()) return text
  const row = { when: formatDate(entry.now, 'YYYY-MM-DD HH:mm'), from: from || '—', to: to || '—', by: entry.by }
  return writeLog(setFrontmatterField(text, 'location', to), [...locationLog(text), row])
}

/** Sets a sample's status, logging it like a move so the record says when it was used up or thrown away. */
export function setSampleStatus(text: string, status: SampleStatus, entry: { by: string; now: Date }): string {
  const { fields } = parseFrontmatter(text)
  if (asStatus(fields.status) === status) return text
  const location = fields.location ?? ''
  const row = { when: formatDate(entry.now, 'YYYY-MM-DD HH:mm'), from: location || '—', to: status, by: entry.by }
  return writeLog(setFrontmatterField(text, 'status', status), [...locationLog(text), row])
}
