import { EditorSelection } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { parseFrontmatter } from '@shared/notes/frontmatter'
import { formatDate } from '@shared/notes/templates'
import { toggleRunTask } from '@shared/records/runs'

const FRONTMATTER_SCAN = 4000

/** Wraps each selection in `marker` (e.g. "**"), or removes it if it's already there. */
export function toggleWrap(view: EditorView, marker: string): boolean {
  if (view.state.readOnly) return false
  const n = marker.length
  view.dispatch(
    view.state.changeByRange((range) => {
      const doc = view.state.doc
      const text = doc.sliceString(range.from, range.to)
      const before = doc.sliceString(Math.max(0, range.from - n), range.from)
      const after = doc.sliceString(range.to, range.to + n)
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - n, to: range.from },
            { from: range.to, to: range.to + n }
          ],
          range: EditorSelection.range(range.from - n, range.to - n)
        }
      }
      if (text.length > 2 * n && text.startsWith(marker) && text.endsWith(marker)) {
        return {
          changes: { from: range.from, to: range.to, insert: text.slice(n, -n) },
          range: EditorSelection.range(range.from, range.to - 2 * n)
        }
      }
      return {
        changes: { from: range.from, to: range.to, insert: marker + text + marker },
        range: EditorSelection.range(range.from + n, range.to + n)
      }
    })
  )
  view.focus()
  return true
}

/** Wraps the selection in [[ ]], or starts an empty link so autocomplete can suggest notes. */
export function insertWikilink(view: EditorView): boolean {
  if (view.state.readOnly) return false
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.doc.sliceString(range.from, range.to)
      return {
        changes: { from: range.from, to: range.to, insert: `[[${text}]]` },
        range: text ? EditorSelection.cursor(range.to + 4) : EditorSelection.cursor(range.from + 2)
      }
    })
  )
  view.focus()
  return true
}

/** Makes the current lines headings of `level`, or plain text if they already are. */
export function toggleHeading(view: EditorView, level: number): boolean {
  if (view.state.readOnly) return false
  const prefix = '#'.repeat(level) + ' '
  const changes = []
  const seen = new Set<number>()
  for (const range of view.state.selection.ranges) {
    const line = view.state.doc.lineAt(range.head)
    if (seen.has(line.number)) continue
    seen.add(line.number)
    const existing = /^#{1,6}\s+/.exec(line.text)?.[0] ?? ''
    const insert = existing === prefix ? '' : prefix
    changes.push({ from: line.from, to: line.from + existing.length, insert })
  }
  view.dispatch({ changes })
  view.focus()
  return true
}

/**
 * Ticks or unticks the task on the line at `pos`. In a protocol run, ticking a step records when it was
 * done, just as clicking its checkbox does. Returns false if the line isn't a task.
 */
export function toggleTaskAt(view: EditorView, pos: number): boolean {
  if (view.state.readOnly) return false
  const line = view.state.doc.lineAt(pos)
  const m = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/.exec(line.text)
  if (!m) return false
  const box = line.from + m[1].length
  const checked = m[2] !== ' '
  const { fields } = parseFrontmatter(view.state.sliceDoc(0, FRONTMATTER_SCAN))
  if (fields.type === 'run') {
    const today = formatDate(new Date(), 'YYYY-MM-DD')
    const insert = toggleRunTask(line.text, !checked, new Date(), fields.started?.slice(0, 10) || today)
    view.dispatch({ changes: { from: line.from, to: line.to, insert } })
  } else {
    view.dispatch({ changes: { from: box + 1, to: box + 2, insert: checked ? ' ' : 'x' } })
  }
  return true
}

/** Ticks or unticks the step on the cursor's line. */
export function toggleTaskAtCursor(view: EditorView): boolean {
  const done = toggleTaskAt(view, view.state.selection.main.head)
  if (done) view.focus()
  return done
}

/** Inserts text at each cursor, replacing any selection. */
export function insertAtCursor(view: EditorView, text: string): boolean {
  if (view.state.readOnly) return false
  view.dispatch(view.state.replaceSelection(text))
  view.focus()
  return true
}

/** "2026-10-02 14:05" by default; the format can be changed in settings. */
export function nowStamp(now = new Date(), format = 'YYYY-MM-DD HH:mm'): string {
  return formatDate(now, format)
}
