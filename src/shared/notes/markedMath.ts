import type { TokenizerAndRendererExtension } from 'marked'

/**
 * `$inline$` and `$$display$$` equations for marked, matching how the editor finds them: the opening `$`
 * isn't followed by a space, the closing one isn't preceded by one, and "$40 and $55" stays text.
 */
export function mathExtensions(render: (tex: string, displayMode: boolean) => string): TokenizerAndRendererExtension[] {
  return [
    {
      name: 'blockMath',
      level: 'block',
      start: (src) => src.match(/^\$\$/m)?.index,
      tokenizer(src) {
        const m = /^\$\$([\s\S]+?)\$\$[ \t]*(?:\n|$)/.exec(src)
        if (m) return { type: 'blockMath', raw: m[0], text: m[1].trim() }
        return undefined
      },
      renderer: (token) => `<div class="math">${render(token.text as string, true)}</div>\n`
    },
    {
      name: 'inlineMath',
      level: 'inline',
      start: (src) => src.indexOf('$'),
      tokenizer(src) {
        const m = /^\$(?!\s)((?:\\.|[^$\\\n])+?)(?<!\s)\$(?!\d)/.exec(src)
        if (m) return { type: 'inlineMath', raw: m[0], text: m[1] }
        return undefined
      },
      renderer: (token) => render(token.text as string, false)
    }
  ]
}
