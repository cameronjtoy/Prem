import { syntaxTree } from '@codemirror/language'
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state'
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate
} from '@codemirror/view'
import type { SyntaxNodeRef } from '@lezer/common'
import { splitLinkText } from '@shared/wikilinks'
import { hostFacet, refreshLinks } from './host'
import { CheckboxWidget, MathWidget, TableWidget, WikiLinkWidget } from './widgets'

const hide = Decoration.replace({})
const lineClass = (cls: string) => Decoration.line({ class: cls })
const mark = (cls: string) => Decoration.mark({ class: cls })

/** Returns the range of a leading `---` YAML frontmatter block, if there is one. */
function frontmatter(state: EditorState): { from: number; to: number } | null {
  const doc = state.doc
  if (doc.lines < 2 || doc.line(1).text.trim() !== '---') return null
  for (let i = 2; i <= doc.lines; i++) {
    if (/^(---|\.\.\.)\s*$/.test(doc.line(i).text)) return { from: 0, to: doc.line(i).to }
  }
  return null
}

function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>()
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) lines.add(n)
  }
  return lines
}

/**
 * Inline live preview: hides markdown syntax and renders links, math and checkboxes,
 * except on lines containing the cursor, where the raw markdown stays editable.
 */
function buildInline(view: EditorView): DecorationSet {
  const { state } = view
  const host = state.facet(hostFacet)
  const active = activeLines(state)
  const isActive = (pos: number): boolean => active.has(state.doc.lineAt(pos).number)
  const fm = frontmatter(state)
  const decos: Range<Decoration>[] = []
  const lineDecos = new Set<string>()

  const addLines = (from: number, to: number, cls: string): void => {
    const last = state.doc.lineAt(to).number
    for (let n = state.doc.lineAt(from).number; n <= last; n++) {
      const pos = state.doc.line(n).from
      const key = `${pos}:${cls}`
      if (!lineDecos.has(key)) {
        lineDecos.add(key)
        decos.push(lineClass(cls).range(pos))
      }
    }
  }

  if (fm) addLines(fm.from, fm.to, 'cm-md-frontmatter')

  const visit = (node: SyntaxNodeRef): boolean | void => {
    if (fm && node.to <= fm.to) return false
    const name = node.name
    const heading = /^ATXHeading(\d)$/.exec(name)
    if (heading) {
      addLines(node.from, node.to, `cm-md-h${heading[1]}`)
      return
    }
    switch (name) {
      case 'HeaderMark': {
        if (!node.node.parent?.name.startsWith('ATXHeading') || isActive(node.from)) return
        const end = state.sliceDoc(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
        decos.push(hide.range(node.from, end))
        return
      }
      case 'EmphasisMark':
      case 'StrikethroughMark':
      case 'QuoteMark':
        if (!isActive(node.from)) decos.push(hide.range(node.from, node.to))
        return
      case 'CodeMark':
        if (node.node.parent?.name === 'InlineCode' && !isActive(node.from)) {
          decos.push(hide.range(node.from, node.to))
        }
        return
      case 'InlineCode':
        decos.push(mark('cm-md-inline-code').range(node.from, node.to))
        return
      case 'FencedCode':
        addLines(node.from, node.to, 'cm-md-codeblock')
        return
      case 'Blockquote':
        addLines(node.from, node.to, 'cm-md-quote')
        return
      case 'HorizontalRule':
        if (!isActive(node.from)) addLines(node.from, node.to, 'cm-md-hr')
        return
      case 'Link': {
        const marks = node.node.getChildren('LinkMark')
        if (marks.length < 2) return false
        const textFrom = marks[0].to
        const textTo = marks[1].from
        if (textTo > textFrom) decos.push(mark('cm-md-link').range(textFrom, textTo))
        if (!isActive(node.from)) {
          decos.push(hide.range(node.from, textFrom))
          decos.push(hide.range(textTo, node.to))
        }
        return false
      }
      case 'WikiLink': {
        const inner = state.sliceDoc(node.from + 2, node.to - 2)
        const { target } = splitLinkText(inner)
        if (!target) return false
        const resolved = host.resolve(target) !== null
        if (isActive(node.from)) {
          const cls = resolved ? 'cm-wikilink-source' : 'cm-wikilink-source cm-wikilink-unresolved'
          decos.push(mark(cls).range(node.from, node.to))
        } else {
          decos.push(Decoration.replace({ widget: new WikiLinkWidget(inner, resolved) }).range(node.from, node.to))
        }
        return false
      }
      case 'InlineMath':
        if (isActive(node.from)) decos.push(mark('cm-math-source').range(node.from, node.to))
        else {
          const tex = state.sliceDoc(node.from + 1, node.to - 1)
          decos.push(Decoration.replace({ widget: new MathWidget(tex, false) }).range(node.from, node.to))
        }
        return false
      case 'ListMark': {
        const next = node.node.nextSibling
        const isBullet = /^[-*+]$/.test(state.sliceDoc(node.from, node.to))
        // Bullets before a checkbox are redundant; numbers are kept because runbook steps rely on them.
        if (next?.name === 'Task' && isBullet && !isActive(node.from)) decos.push(hide.range(node.from, next.from))
        else decos.push(mark('cm-md-list-mark').range(node.from, node.to))
        return
      }
      case 'TaskMarker': {
        const checked = /x/i.test(state.sliceDoc(node.from + 1, node.to - 1))
        decos.push(Decoration.replace({ widget: new CheckboxWidget(checked) }).range(node.from, node.to))
        if (checked) {
          const line = state.doc.lineAt(node.from)
          if (node.to < line.to) decos.push(mark('cm-task-done').range(node.to, line.to))
        }
        return
      }
    }
  }

  const tree = syntaxTree(state)
  for (const { from, to } of view.visibleRanges) tree.iterate({ from, to, enter: visit })
  return Decoration.set(decos, true)
}

const inlinePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = buildInline(view)
    }
    update(u: ViewUpdate): void {
      if (
        u.docChanged ||
        u.viewportChanged ||
        u.selectionSet ||
        syntaxTree(u.startState) !== syntaxTree(u.state) ||
        u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)))
      ) {
        this.decorations = buildInline(u.view)
      }
    }
  },
  { decorations: (v) => v.decorations }
)

/**
 * Block-level widgets (display math and tables) must come from a StateField, because
 * decorations that span line breaks can't be provided by a ViewPlugin.
 */
function buildBlocks(state: EditorState): DecorationSet {
  const decos: Range<Decoration>[] = []
  const touches = (from: number, to: number): boolean =>
    state.selection.ranges.some((r) => r.from <= to && r.to >= from)

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name !== 'BlockMath' && node.name !== 'Table') return
      const from = state.doc.lineAt(node.from).from
      const to = state.doc.lineAt(Math.max(node.from, node.to - 1)).to
      if (touches(from, to)) return false
      const text = state.sliceDoc(from, to)
      const widget =
        node.name === 'BlockMath'
          ? new MathWidget(text.trim().replace(/^\$\$/, '').replace(/\$\$$/, '').trim(), true)
          : new TableWidget(text)
      decos.push(Decoration.replace({ widget, block: true }).range(from, to))
      return false
    }
  })
  return Decoration.set(decos, true)
}

const blockPreview = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(decos, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state) ||
      tr.effects.some((e) => e.is(refreshLinks))
    ) {
      return buildBlocks(tr.state)
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f)
})

function linkUrlAt(view: EditorView, pos: number): string | null {
  for (let node = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent!) {
    if (node.name === 'Link') {
      const url = node.getChild('URL')
      return url ? view.state.sliceDoc(url.from, url.to) : null
    }
    if (!node.parent) break
  }
  return null
}

function wikiTargetAt(view: EditorView, pos: number): string | null {
  for (let node = syntaxTree(view.state).resolveInner(pos, 1); node; node = node.parent!) {
    if (node.name === 'WikiLink') return splitLinkText(view.state.sliceDoc(node.from + 2, node.to - 2)).target
    if (!node.parent) break
  }
  return null
}

/** Plain click on a rendered link follows it; Cmd/Ctrl-click follows links in raw markdown too. */
const linkClicks = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false
    const target = event.target as HTMLElement
    const mod = event.metaKey || event.ctrlKey
    const onRenderedLink = !!target.closest('.cm-md-link')
    if (!mod && !onRenderedLink) return false
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY })
    if (pos === null) return false
    const host = view.state.facet(hostFacet)

    const wiki = mod ? wikiTargetAt(view, pos) : null
    if (wiki) {
      event.preventDefault()
      host.openLink(wiki)
      return true
    }
    if (!mod && activeLines(view.state).has(view.state.doc.lineAt(pos).number)) return false
    const url = linkUrlAt(view, pos)
    if (!url) return false
    event.preventDefault()
    if (/^(https?:|mailto:)/i.test(url)) host.openExternal(url)
    else {
      let decoded = url
      try {
        decoded = decodeURI(url)
      } catch {
        // Keep the raw URL if it isn't valid percent-encoding.
      }
      host.openLink(decoded.replace(/\.md$/i, ''))
    }
    return true
  }
})

export const livePreview: Extension = [inlinePreview, blockPreview, linkClicks]
