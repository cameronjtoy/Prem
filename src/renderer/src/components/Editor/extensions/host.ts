import { Annotation, Facet, StateEffect } from '@codemirror/state'

/** Callbacks from the editor back into the app. */
export interface EditorHost {
  resolve(target: string): string | null
  openLink(target: string): void
  openExternal(url: string): void
  noteTitles(): string[]
  /** Vault path of a relative link to an attachment, or null if it's a web link or a note. */
  resolveFile(url: string): string | null
  loadFile(path: string): Promise<Uint8Array>
  openFile(path: string): void
  /** Stores a file as an attachment of this note and returns the markdown that shows it. */
  addAttachment(fileName: string, data: Uint8Array): Promise<string>
  notify(message: string): void
}

export const hostFacet = Facet.define<EditorHost, EditorHost>({
  combine: (values) => values[0]
})

/** Dispatched when the set of notes changes, so link decorations re-check what resolves. */
export const refreshLinks = StateEffect.define<null>()

/** Marks transactions that load content from disk, so they don't trigger an autosave. */
export const fromDisk = Annotation.define<boolean>()
