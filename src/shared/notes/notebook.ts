import { VaultError } from '../vault/errors'
import { joinPath, sanitizeFileName } from '../vault/paths'
import type { VaultPath } from '../vault/types'

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** Parses a `YYYY-MM-DD` day as local midnight, rejecting anything that isn't a real calendar date. */
export function parseDay(day: string): Date {
  const m = DAY.exec(day)
  const date = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
  if (!m || !date || date.getMonth() !== Number(m[2]) - 1 || date.getDate() !== Number(m[3])) {
    throw new VaultError('INVALID_ARGUMENT', `Not a valid day: ${day}`)
  }
  return date
}

/**
 * Where a person's notebook lives. A local vault belongs to one person, so it's just "Notebook".
 * On a team vault each person gets their own folder, which lines up with per-person permissions.
 */
export function notebookFolder(user?: string): VaultPath {
  return user ? joinPath('Notebooks', sanitizeFileName(user)) : 'Notebook'
}

/** The daily entry for a day, filed by year so a notebook folder stays browsable after a few years. */
export function dailyNotePath(day: string, user?: string): VaultPath {
  parseDay(day)
  return joinPath(joinPath(notebookFolder(user), day.slice(0, 4)), `${day}.md`)
}
