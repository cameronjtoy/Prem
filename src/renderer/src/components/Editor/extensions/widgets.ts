import { WidgetType, type EditorView } from '@codemirror/view'
import katex from 'katex'
import { parseFrontmatter } from '@shared/frontmatter'
import { toggleRunTask } from '@shared/runs'
import { formatDate } from '@shared/templates'
import { splitLinkText } from '@shared/wikilinks'
import { hostFacet } from './host'

/** Frontmatter is at the top of a note; this is plenty to read it without copying the whole document. */
const FRONTMATTER_SCAN = 4000

function renderMath(el: HTMLElement, tex: string, displayMode: boolean): void {
  try {
    katex.render(tex, el, { displayMode, throwOnError: false, trust: false, strict: 'ignore' })
  } catch {
    el.textContent = tex
    el.classList.add('cm-math-error')
  }
}

function linkElement(view: EditorView, inner: string): HTMLElement {
  const { target, heading, alias } = splitLinkText(inner)
  const host = view.state.facet(hostFacet)
  const resolved = host.resolve(target) !== null
  const el = document.createElement('span')
  el.className = resolved ? 'cm-wikilink' : 'cm-wikilink cm-wikilink-unresolved'
  el.textContent = alias ?? (heading ? `${target} › ${heading}` : target)
  el.title = resolved ? target : `${target} — click to create this note`
  el.addEventListener('mousedown', (e) => {
    e.preventDefault()
    e.stopPropagation()
    view.state.facet(hostFacet).openLink(target)
  })
  return el
}

export class WikiLinkWidget extends WidgetType {
  constructor(
    readonly inner: string,
    readonly resolved: boolean
  ) {
    super()
  }
  eq(other: WikiLinkWidget): boolean {
    return other.inner === this.inner && other.resolved === this.resolved
  }
  toDOM(view: EditorView): HTMLElement {
    return linkElement(view, this.inner)
  }
  ignoreEvent(): boolean {
    return true
  }
}

export class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean
  ) {
    super()
  }
  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display
  }
  toDOM(): HTMLElement {
    const el = document.createElement(this.display ? 'div' : 'span')
    el.className = this.display ? 'cm-math-block' : 'cm-math-inline'
    renderMath(el, this.tex, this.display)
    return el
  }
  // Let clicks through so the cursor moves into the formula and reveals its source.
  ignoreEvent(): boolean {
    return false
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.className = 'cm-task-checkbox'
    box.checked = this.checked
    box.disabled = view.state.readOnly
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (view.state.readOnly) return
      const pos = view.posAtDOM(box)
      if (!/^\[[ xX]\]$/.test(view.state.sliceDoc(pos, pos + 3))) return
      const { fields } = parseFrontmatter(view.state.sliceDoc(0, FRONTMATTER_SCAN))
      if (fields.type === 'run') {
        // In a protocol run, ticking a step records when it was done.
        const line = view.state.doc.lineAt(pos)
        const today = formatDate(new Date(), 'YYYY-MM-DD')
        const insert = toggleRunTask(line.text, !this.checked, new Date(), fields.started?.slice(0, 10) || today)
        view.dispatch({ changes: { from: line.from, to: line.to, insert } })
        return
      }
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: this.checked ? ' ' : 'x' } })
    })
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}

type Align = 'left' | 'center' | 'right' | null

function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function renderInline(view: EditorView, parent: HTMLElement, text: string): void {
  const parts = text.split(/(\[\[[^[\]\n]+\]\]|`[^`]+`|\*\*[^*]+\*\*|\$(?!\s)[^$]+?(?<!\s)\$)/)
  parts.forEach((part, i) => {
    if (!part) return
    // split() with one capture group puts the matched tokens at odd indexes; even ones are plain text.
    if (i % 2 === 0) parent.append(part)
    else if (part.startsWith('[[')) parent.append(linkElement(view, part.slice(2, -2)))
    else if (part.startsWith('`')) {
      const code = document.createElement('code')
      code.textContent = part.slice(1, -1)
      parent.append(code)
    } else if (part.startsWith('**')) {
      const strong = document.createElement('strong')
      strong.textContent = part.slice(2, -2)
      parent.append(strong)
    } else {
      const span = document.createElement('span')
      renderMath(span, part.slice(1, -1), false)
      parent.append(span)
    }
  })
}

export class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super()
  }
  eq(other: TableWidget): boolean {
    return other.source === this.source
  }
  toDOM(view: EditorView): HTMLElement {
    const [header = '', delimiter = '', ...body] = this.source.split('\n')
    const align: Align[] = splitRow(delimiter).map((d) => {
      const left = d.startsWith(':')
      const right = d.endsWith(':')
      return left && right ? 'center' : right ? 'right' : left ? 'left' : null
    })
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-widget'
    const table = document.createElement('table')
    const addRow = (section: HTMLElement, cells: string[], tag: 'th' | 'td'): void => {
      const tr = document.createElement('tr')
      cells.forEach((cell, i) => {
        const el = document.createElement(tag)
        if (align[i]) el.style.textAlign = align[i]!
        renderInline(view, el, cell)
        tr.append(el)
      })
      section.append(tr)
    }
    const thead = document.createElement('thead')
    addRow(thead, splitRow(header), 'th')
    const tbody = document.createElement('tbody')
    for (const line of body) if (line.trim()) addRow(tbody, splitRow(line), 'td')
    table.append(thead, tbody)
    wrap.append(table)
    return wrap
  }
  ignoreEvent(): boolean {
    return false
  }
}
