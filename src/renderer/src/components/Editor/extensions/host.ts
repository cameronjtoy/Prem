import { Annotation, Facet, StateEffect } from '@codemirror/state'

/** Callbacks from the editor back into the app. */
export interface EditorHost {
  resolve(target: string): string | null
  openLink(target: string): void
  openExternal(url: string): void
  noteTitles(): string[]
}

export const hostFacet = Facet.define<EditorHost, EditorHost>({
  combine: (values) => values[0]
})

/** Dispatched when the set of notes changes, so link decorations re-check what resolves. */
export const refreshLinks = StateEffect.define<null>()

/** Marks transactions that load content from disk, so they don't trigger an autosave. */
export const fromDisk = Annotation.define<boolean>()
