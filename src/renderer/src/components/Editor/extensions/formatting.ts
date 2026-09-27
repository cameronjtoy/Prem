import { syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  Prec,
  type ChangeSpec,
  type EditorState,
  type Line,
  type TransactionSpec
} from '@codemirror/state'
import { keymap, type Command } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'

/** A formatting action as a pure function of editor state, so it can be tested without a view. */
export type Format = (state: EditorState) => TransactionSpec | null

export const run =
  (format: Format): Command =>
  (view) => {
    const spec = format(view.state)
    if (!spec) return false
    view.dispatch(view.state.update({ scrollIntoView: true, userEvent: 'input.format', ...spec }))
    return true
  }

// ---------- Inline styles ----------

export type InlineKind = 'bold' | 'italic' | 'strike' | 'code' | 'math'

const INLINE: Record<InlineKind, { marker: string; node: string; mark: string }> = {
  bold: { marker: '**', node: 'StrongEmphasis', mark: 'EmphasisMark' },
  // Underscores, so italic can't be confused with the asterisks of bold text.
  italic: { marker: '_', node: 'Emphasis', mark: 'EmphasisMark' },
  strike: { marker: '~~', node: 'Strikethrough', mark: 'StrikethroughMark' },
  code: { marker: '`', node: 'InlineCode', mark: 'CodeMark' },
  math: { marker: '$', node: 'InlineMath', mark: 'MathMark' }
}

function enclosing(state: EditorState, from: number, to: number, name: string): SyntaxNode | null {
  const tree = syntaxTree(state)
  for (const side of [1, -1] as const) {
    for (let n: SyntaxNode | null = tree.resolveInner(from, side); n; n = n.parent) {
      if (n.name === name && n.from <= from && n.to >= to) return n
    }
  }
  return null
}

export function isInlineActive(state: EditorState, kind: InlineKind): boolean {
  const { from, to } = state.selection.main
  return enclosing(state, from, to, INLINE[kind].node) !== null
}

/** Wraps the selection (or the word at the cursor) in a style, or removes the style if already applied. */
export const toggleInline =
  (kind: InlineKind): Format =>
  (state) => {
    const { marker, node: nodeName, mark } = INLINE[kind]
    const range = state.selection.main
    const node = enclosing(state, range.from, range.to, nodeName)
    if (node) {
      const marks = node.getChildren(mark)
      if (marks.length >= 2) {
        const open = marks[0]
        const close = marks[marks.length - 1]
        const changes = state.changes([
          { from: open.from, to: open.to },
          { from: close.from, to: close.to }
        ])
        return {
          changes,
          selection: EditorSelection.range(changes.mapPos(range.anchor), changes.mapPos(range.head))
        }
      }
    }

    let { from, to } = range
    if (range.empty) {
      const word = state.wordAt(from)
      if (word) ({ from, to } = word)
    }
    if (from === to) {
      return {
        changes: { from, insert: marker + marker },
        selection: EditorSelection.cursor(from + marker.length)
      }
    }
    // Markdown won't recognise "** bold **", so keep surrounding spaces outside the markers.
    const text = state.sliceDoc(from, to)
    from += text.length - text.trimStart().length
    to -= text.length - text.trimEnd().length
    const len = marker.length
    return {
      changes: [
        { from, insert: marker },
        { from: to, insert: marker }
      ],
      selection: range.empty
        ? EditorSelection.cursor(range.head + len)
        : EditorSelection.range(from + len, to + len)
    }
  }

// ---------- Line styles ----------

function selectedLines(state: EditorState): Line[] {
  const { from, to } = state.selection.main
  const lines: Line[] = []
  for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) lines.push(state.doc.line(n))
  return lines
}

/** Applies line changes and keeps the cursor after any prefix inserted where it sits. */
function lineEdit(state: EditorState, specs: ChangeSpec[]): TransactionSpec {
  const changes = state.changes(specs)
  const { anchor, head } = state.selection.main
  return { changes, selection: EditorSelection.range(changes.mapPos(anchor, 1), changes.mapPos(head, 1)) }
}

const HEADING_RE = /^(#{1,6})[ \t]+/

export function headingLevel(state: EditorState): number {
  const m = HEADING_RE.exec(state.doc.lineAt(state.selection.main.head).text)
  return m ? m[1].length : 0
}

/** Level 0 turns headings back into normal text. */
export const setHeading =
  (level: number): Format =>
  (state) =>
    lineEdit(
      state,
      selectedLines(state).map((line) => {
        const existing = HEADING_RE.exec(line.text)?.[0].length ?? 0
        return { from: line.from, to: line.from + existing, insert: level > 0 ? '#'.repeat(level) + ' ' : '' }
      })
    )

export type BlockKind = 'bullet' | 'number' | 'task' | 'quote'

const PREFIX_RE = /^(\s*)([-*+] \[[ xX]\] |[-*+] |\d+[.)] |> ?)?/

function kindOf(prefix: string | undefined): BlockKind | null {
  if (!prefix) return null
  if (prefix.includes('[')) return 'task'
  if (prefix.startsWith('>')) return 'quote'
  return /^\d/.test(prefix) ? 'number' : 'bullet'
}

export function blockKind(state: EditorState): BlockKind | null {
  return kindOf(PREFIX_RE.exec(state.doc.lineAt(state.selection.main.head).text)?.[2])
}

/** Turns the selected lines into a list or quote, or back into plain lines if they already are one. */
export const toggleBlock =
  (kind: BlockKind): Format =>
  (state) => {
    let lines = selectedLines(state)
    if (lines.length > 1) lines = lines.filter((l) => l.text.trim())
    if (!lines.length) return null
    const removing = lines.every((l) => kindOf(PREFIX_RE.exec(l.text)?.[2]) === kind)
    return lineEdit(
      state,
      lines.map((line, i) => {
        const m = PREFIX_RE.exec(line.text)!
        const from = line.from + m[1].length
        const to = from + (m[2]?.length ?? 0)
        if (removing) return { from, to, insert: '' }
        const insert = { bullet: '- ', task: '- [ ] ', number: `${i + 1}. `, quote: '> ' }[kind]
        return { from, to, insert }
      })
    )
  }

// ---------- Inserts ----------

/** Inserts a block on its own line and selects the part the user will want to type over. */
function insertBlock(state: EditorState, text: string, select: [number, number]): TransactionSpec {
  const line = state.doc.lineAt(state.selection.main.head)
  const blank = !line.text.trim()
  const from = blank ? line.from : line.to
  const prefix = blank ? '' : '\n'
  const base = from + prefix.length
  return {
    changes: { from, to: blank ? line.to : from, insert: prefix + text },
    selection: EditorSelection.range(base + select[0], base + select[1])
  }
}

export const insertLink: Format = (state) => {
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  if (/^(https?:\/\/|mailto:)\S+$/.test(text)) {
    return { changes: { from, to, insert: `[](${text})` }, selection: EditorSelection.cursor(from + 1) }
  }
  const label = text || 'link text'
  const insert = `[${label}](https://)`
  const selection = text
    ? EditorSelection.range(from + label.length + 3, from + insert.length - 1)
    : EditorSelection.range(from + 1, from + 1 + label.length)
  return { changes: { from, to, insert }, selection }
}

/** Starts a [[wikilink]]; the typing user event makes note-name suggestions appear. */
export const insertNoteLink: Format = (state) => {
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  return {
    changes: { from, to, insert: `[[${text}]]` },
    selection: EditorSelection.cursor(from + 2 + text.length),
    userEvent: 'input.type'
  }
}

export const insertTable: Format = (state) =>
  insertBlock(state, '| Column 1 | Column 2 |\n| --- | --- |\n|  |  |', [2, 10])

export const insertCodeBlock: Format = (state) => {
  const { from, to } = state.selection.main
  if (from === to) return insertBlock(state, '```\n\n```', [4, 4])
  const first = state.doc.lineAt(from)
  const last = state.doc.lineAt(to)
  return lineEdit(state, [
    { from: first.from, insert: '```\n' },
    { from: last.to, insert: '\n```' }
  ])
}

/** Inline math for a short single-line selection, otherwise a display equation block. */
export const insertMath: Format = (state) => {
  const { from, to } = state.selection.main
  const text = state.sliceDoc(from, to)
  if (text && !text.includes('\n')) return toggleInline('math')(state)
  if (text) return insertBlock(state, `$$\n${text}\n$$`, [3, 3 + text.length])
  return insertBlock(state, '$$\n\n$$', [3, 3])
}

export const insertDivider: Format = (state) => insertBlock(state, '---\n', [4, 4])

// ---------- Keyboard shortcuts ----------

export const formattingKeymap = Prec.high(
  keymap.of([
    { key: 'Mod-b', run: run(toggleInline('bold')) },
    { key: 'Mod-i', run: run(toggleInline('italic')) },
    { key: 'Mod-Shift-x', run: run(toggleInline('strike')) },
    { key: 'Mod-e', run: run(toggleInline('code')) },
    { key: 'Mod-k', run: run(insertLink) },
    { key: 'Mod-Alt-0', run: run(setHeading(0)) },
    { key: 'Mod-Alt-1', run: run(setHeading(1)) },
    { key: 'Mod-Alt-2', run: run(setHeading(2)) },
    { key: 'Mod-Alt-3', run: run(setHeading(3)) },
    { key: 'Mod-Shift-7', run: run(toggleBlock('number')) },
    { key: 'Mod-Shift-8', run: run(toggleBlock('bullet')) },
    { key: 'Mod-Shift-9', run: run(toggleBlock('task')) }
  ])
)
