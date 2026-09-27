import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete'
import { hostFacet } from './host'

function wikilinkCompletions(ctx: CompletionContext): CompletionResult | null {
  const before = ctx.matchBefore(/\[\[[^[\]|#\n]*$/)
  if (!before) return null
  const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === ']]'
  const titles = ctx.state.facet(hostFacet).noteTitles()
  return {
    from: before.from + 2,
    options: titles.map((title) => ({ label: title, type: 'text', apply: closed ? title : `${title}]]` })),
    validFor: /^[^[\]|#\n]*$/
  }
}

/** Typing [[ suggests note names from the vault. */
export const wikilinkAutocomplete = autocompletion({
  override: [wikilinkCompletions],
  icons: false,
  activateOnTyping: true
})
