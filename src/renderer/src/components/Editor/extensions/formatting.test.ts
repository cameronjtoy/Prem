import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorSelection, EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import {
  blockKind,
  headingLevel,
  insertCodeBlock,
  insertLink,
  insertMath,
  insertTable,
  isInlineActive,
  setHeading,
  toggleBlock,
  toggleInline,
  type Format
} from './formatting'
import { MathSyntax, WikiLinkSyntax } from './syntax'

/** Builds a state from text where "[" and "]" mark the selection, or "|" marks the cursor. */
function make(marked: string): EditorState {
  let doc = marked
  let anchor: number
  let head: number
  if (marked.includes('|')) {
    anchor = head = marked.indexOf('|')
    doc = marked.replace('|', '')
  } else {
    anchor = marked.indexOf('[')
    doc = marked.replace('[', '')
    head = doc.indexOf(']')
    doc = doc.replace(']', '')
  }
  return EditorState.create({
    doc,
    selection: EditorSelection.range(anchor, head),
    extensions: markdown({ base: markdownLanguage, extensions: [WikiLinkSyntax, MathSyntax] })
  })
}

function apply(state: EditorState, format: Format): { doc: string; selected: string; state: EditorState } {
  const spec = format(state)
  if (!spec) throw new Error('format made no change')
  const next = state.update(spec).state
  const { from, to } = next.selection.main
  return { doc: next.doc.toString(), selected: next.sliceDoc(from, to), state: next }
}

describe('inline styles', () => {
  it('wraps a selection and keeps it selected', () => {
    const r = apply(make('make [this] bold'), toggleInline('bold'))
    expect(r.doc).toBe('make **this** bold')
    expect(r.selected).toBe('this')
    expect(isInlineActive(r.state, 'bold')).toBe(true)
  })

  it('removes the style when applied again', () => {
    const once = apply(make('make [this] bold'), toggleInline('bold'))
    const twice = apply(once.state, toggleInline('bold'))
    expect(twice.doc).toBe('make this bold')
    expect(twice.selected).toBe('this')
  })

  it('removes the style when the cursor is anywhere inside it', () => {
    expect(apply(make('a **bo|ld** b'), toggleInline('bold')).doc).toBe('a bold b')
    expect(apply(make('a *it|alic* b'), toggleInline('italic')).doc).toBe('a italic b')
  })

  it('wraps the word at the cursor, or inserts empty markers', () => {
    expect(apply(make('one tw|o three'), toggleInline('italic')).doc).toBe('one _two_ three')
    const empty = apply(make('end |'), toggleInline('code'))
    expect(empty.doc).toBe('end ``')
    expect(empty.state.selection.main.head).toBe(5)
  })

  it('keeps spaces outside the markers', () => {
    expect(apply(make('a[ word ]b'), toggleInline('strike')).doc).toBe('a ~~word~~ b')
  })

  it('does not confuse italic with bold', () => {
    const r = apply(make('**[bold]**'), toggleInline('italic'))
    expect(r.doc).toBe('**_bold_**')
  })
})

describe('headings', () => {
  it('sets, changes and clears the heading level', () => {
    const h2 = apply(make('Ti|tle'), setHeading(2))
    expect(h2.doc).toBe('## Title')
    expect(headingLevel(h2.state)).toBe(2)
    expect(apply(h2.state, setHeading(1)).doc).toBe('# Title')
    expect(apply(h2.state, setHeading(0)).doc).toBe('Title')
  })
})

describe('lists and quotes', () => {
  it('turns lines into a numbered list, skipping blank lines', () => {
    expect(apply(make('[a\n\nb\nc]'), toggleBlock('number')).doc).toBe('1. a\n\n2. b\n3. c')
  })

  it('switches between list types and toggles off', () => {
    const bullets = apply(make('[a\nb]'), toggleBlock('bullet'))
    expect(bullets.doc).toBe('- a\n- b')
    expect(blockKind(bullets.state)).toBe('bullet')
    const tasks = apply(bullets.state, toggleBlock('task'))
    expect(tasks.doc).toBe('- [ ] a\n- [ ] b')
    expect(apply(tasks.state, toggleBlock('task')).doc).toBe('a\nb')
  })

  it('puts the cursor after a new prefix on an empty line', () => {
    const r = apply(make('|'), toggleBlock('task'))
    expect(r.doc).toBe('- [ ] ')
    expect(r.state.selection.main.head).toBe(6)
  })

  it('keeps indentation', () => {
    expect(apply(make('  ne|sted'), toggleBlock('bullet')).doc).toBe('  - nested')
  })
})

describe('inserts', () => {
  it('wraps selected text in a link and selects the URL', () => {
    const r = apply(make('see [docs] here'), insertLink)
    expect(r.doc).toBe('see [docs](https://) here')
    expect(r.selected).toBe('https://')
  })

  it('turns a selected URL into a link with the cursor on the label', () => {
    const r = apply(make('[https://example.com]'), insertLink)
    expect(r.doc).toBe('[](https://example.com)')
    expect(r.state.selection.main.head).toBe(1)
  })

  it('inserts a table on a new line and selects the first header', () => {
    const r = apply(make('Intro|'), insertTable)
    expect(r.doc).toBe('Intro\n| Column 1 | Column 2 |\n| --- | --- |\n|  |  |')
    expect(r.selected).toBe('Column 1')
  })

  it('fences selected lines as a code block', () => {
    expect(apply(make('[ls\npwd]'), insertCodeBlock).doc).toBe('```\nls\npwd\n```')
  })

  it('makes inline math from a short selection and a block otherwise', () => {
    expect(apply(make('so [x^2] grows'), insertMath).doc).toBe('so $x^2$ grows')
    const block = apply(make('|'), insertMath)
    expect(block.doc).toBe('$$\n\n$$')
    expect(block.state.selection.main.head).toBe(3)
  })
})
