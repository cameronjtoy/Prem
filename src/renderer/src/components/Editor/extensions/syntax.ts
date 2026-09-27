import { tags as t } from '@lezer/highlight'
import type { MarkdownConfig } from '@lezer/markdown'

const BRACKET = 91 // [
const DOLLAR = 36 // $

/** Parses [[wikilinks]] into WikiLink nodes. */
export const WikiLinkSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: t.link },
    { name: 'WikiLinkMark', style: t.processingInstruction }
  ],
  parseInline: [
    {
      name: 'WikiLink',
      before: 'Link',
      parse(cx, next, pos) {
        if (next !== BRACKET || cx.char(pos + 1) !== BRACKET) return -1
        const m = /^\[\[[^[\]\n]+\]\]/.exec(cx.slice(pos, cx.end))
        if (!m) return -1
        const end = pos + m[0].length
        return cx.addElement(
          cx.elt('WikiLink', pos, end, [cx.elt('WikiLinkMark', pos, pos + 2), cx.elt('WikiLinkMark', end - 2, end)])
        )
      }
    }
  ]
}

const isBlockMathStart = (text: string, pos: number): boolean =>
  text.charCodeAt(pos) === DOLLAR && text.charCodeAt(pos + 1) === DOLLAR

/**
 * Parses $inline$ math and $$...$$ block math.
 * Inline math can't start or end with a space, so "$5 and $10" stays plain text.
 */
export const MathSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'InlineMath', style: t.special(t.string) },
    { name: 'BlockMath', block: true, style: t.special(t.string) },
    { name: 'MathMark', style: t.processingInstruction }
  ],
  parseInline: [
    {
      name: 'InlineMath',
      before: 'Emphasis',
      parse(cx, next, pos) {
        if (next !== DOLLAR || cx.char(pos + 1) === DOLLAR) return -1
        const m = /^\$(?!\s)[^$\n]+?(?<!\s)\$(?!\d)/.exec(cx.slice(pos, cx.end))
        if (!m) return -1
        const end = pos + m[0].length
        return cx.addElement(
          cx.elt('InlineMath', pos, end, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', end - 1, end)])
        )
      }
    }
  ],
  parseBlock: [
    {
      name: 'BlockMath',
      parse(cx, line) {
        if (!isBlockMathStart(line.text, line.pos)) return false
        const from = cx.lineStart + line.pos
        let to = cx.lineStart + line.text.length
        let closed = /\$\$\s*$/.test(line.text.slice(line.pos + 2))
        while (!closed && cx.nextLine()) {
          to = cx.lineStart + line.text.length
          closed = /\$\$\s*$/.test(line.text)
        }
        if (closed) cx.nextLine()
        cx.addElement(cx.elt('BlockMath', from, to))
        return true
      },
      endLeaf: (_cx, line) => isBlockMathStart(line.text, line.pos)
    }
  ]
}
