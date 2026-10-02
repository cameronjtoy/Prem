import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, Prec, type Extension } from '@codemirror/state'
import { drawSelection, dropCursor, EditorView, keymap, lineNumbers } from '@codemirror/view'
import { wikilinkAutocomplete } from './autocomplete'
import { hostFacet, type EditorHost } from './host'
import { livePreview } from './livePreview'
import { MathSyntax, WikiLinkSyntax } from './syntax'
import { editorTheme, highlightStyle } from './theme'

export interface EditorOptions {
  spellcheck: boolean
  lineNumbers: boolean
}

/** The part of the editor that follows settings, so it can change without reopening the note. */
export const optionsCompartment = new Compartment()

export function optionExtensions(options: EditorOptions): Extension {
  return [
    EditorView.contentAttributes.of({ spellcheck: options.spellcheck ? 'true' : 'false' }),
    options.lineNumbers ? lineNumbers() : []
  ]
}

export function createExtensions(
  host: EditorHost,
  onSave: () => void,
  readOnly = false,
  options: EditorOptions = { spellcheck: true, lineNumbers: false }
): Extension[] {
  return [
    optionsCompartment.of(optionExtensions(options)),
    hostFacet.of(host),
    EditorState.readOnly.of(readOnly),
    Prec.highest(keymap.of([{ key: 'Mod-s', preventDefault: true, run: () => (onSave(), true) }])),
    history(),
    drawSelection(),
    dropCursor(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    highlightSelectionMatches(),
    EditorView.lineWrapping,
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      extensions: [WikiLinkSyntax, MathSyntax]
    }),
    syntaxHighlighting(highlightStyle),
    livePreview,
    wikilinkAutocomplete,
    keymap.of([
      ...closeBracketsKeymap,
      ...completionKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      indentWithTab
    ]),
    editorTheme
  ]
}

export { fromDisk, refreshLinks, type EditorHost } from './host'
