import { EditorSelection, EditorState, type Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { isVaultError } from '@shared/vault/errors'
import type { FileRecord } from '@shared/vault/types'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { fromDisk } from './extensions'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

export interface Conflict {
  content: string
  version: string
}

export interface SessionCallbacks {
  onStatus(status: SaveStatus): void
  onConflict(conflict: Conflict | null): void
  onError(message: string | null): void
  /** The first save after starting an amendment went through, so the note is no longer locked. */
  onAmended?(): void
  /** How long to wait after the last keystroke before saving, from settings. */
  autosaveDelay?(): number
}

const AUTOSAVE_MS = 600

/** One open note: its editor view plus the autosave and on-disk conflict handling. */
export class NoteSession {
  readonly view: EditorView
  private version: string
  private saved: string
  private timer: ReturnType<typeof setTimeout> | null = null
  private saving: Promise<void> | null = null
  private conflict: Conflict | null = null
  private discarded = false
  /** Set while amending a signed note: sent with the next save, which records the amendment. */
  private amendReason: string | null = null

  constructor(
    readonly path: string,
    file: FileRecord,
    parent: HTMLElement,
    extensions: (session: NoteSession) => Extension,
    private readonly ui: SessionCallbacks,
    cursor: number | null
  ) {
    this.version = file.version
    this.saved = file.content
    const anchor = Math.min(cursor ?? 0, file.content.length)
    this.view = new EditorView({
      parent,
      state: EditorState.create({
        doc: file.content,
        selection: EditorSelection.cursor(anchor),
        extensions: [
          extensions(this),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(fromDisk))) this.scheduleSave()
          })
        ]
      })
    })
    if (cursor !== null) this.view.dispatch({ effects: EditorView.scrollIntoView(anchor, { y: 'center' }) })
  }

  private get content(): string {
    return this.view.state.doc.toString()
  }

  get dirty(): boolean {
    return this.content !== this.saved
  }

  private scheduleSave(): void {
    this.ui.onStatus('dirty')
    if (this.timer) clearTimeout(this.timer)
    if (this.conflict || this.discarded) return
    this.timer = setTimeout(() => void this.save(), this.ui.autosaveDelay?.() ?? AUTOSAVE_MS)
  }

  async save(overwriteVersion?: string): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    while (this.saving) await this.saving
    if (this.discarded || (this.conflict && !overwriteVersion)) return
    const content = this.content
    if (content === this.saved && !overwriteVersion) {
      this.ui.onStatus('saved')
      return
    }
    this.saving = this.write(content, overwriteVersion ?? this.version)
    try {
      await this.saving
    } finally {
      this.saving = null
    }
  }

  private async write(content: string, expectedVersion: string): Promise<void> {
    this.ui.onStatus('saving')
    try {
      const amending = this.amendReason
      const { version } = await vaultClient.write(this.path, content, {
        expectedVersion,
        amendReason: amending ?? undefined
      })
      if (amending && this.amendReason === amending) {
        this.amendReason = null
        this.ui.onAmended?.()
      }
      this.version = version
      this.saved = content
      this.setConflict(null)
      this.ui.onError(null)
      this.ui.onStatus(this.dirty ? 'dirty' : 'saved')
      if (this.dirty) this.scheduleSave()
    } catch (err) {
      if (isVaultError(err, 'CONFLICT')) {
        const disk = await vaultClient.read(this.path)
        this.setConflict({ content: disk.content, version: disk.version })
        this.ui.onStatus('dirty')
      } else {
        this.ui.onStatus('error')
        this.ui.onError(`Couldn't save: ${errorMessage(err)}`)
      }
    }
  }

  /** Called when the watcher reports this file changed on disk. */
  async handleExternalChange(): Promise<void> {
    let disk: FileRecord
    try {
      disk = await vaultClient.read(this.path)
    } catch {
      return
    }
    if (disk.version === this.version) return
    if (disk.content === this.content) {
      this.version = disk.version
      this.saved = disk.content
      this.ui.onStatus('saved')
      return
    }
    if (!this.dirty && !this.saving) {
      this.load(disk)
      return
    }
    this.setConflict({ content: disk.content, version: disk.version })
  }

  /** Starts amending a signed note: the next save carries the reason and is recorded as an amendment. */
  amend(reason: string): void {
    this.amendReason = reason
  }

  reloadFromDisk(): void {
    if (!this.conflict) return
    this.load({ path: this.path, ...this.conflict })
  }

  keepMine(): Promise<void> {
    return this.conflict ? this.save(this.conflict.version) : Promise.resolve()
  }

  private load(file: FileRecord): void {
    if (this.timer) clearTimeout(this.timer)
    const head = Math.min(this.view.state.selection.main.head, file.content.length)
    this.view.dispatch({
      changes: { from: 0, to: this.view.state.doc.length, insert: file.content },
      selection: EditorSelection.cursor(head),
      annotations: fromDisk.of(true)
    })
    this.version = file.version
    this.saved = file.content
    this.setConflict(null)
    this.ui.onStatus('saved')
  }

  private setConflict(conflict: Conflict | null): void {
    this.conflict = conflict
    this.ui.onConflict(conflict)
  }

  /** Stop saving, e.g. because the file was deleted. */
  discard(): void {
    this.discarded = true
    if (this.timer) clearTimeout(this.timer)
  }

  /** Save any pending edits in the background and tear down the view. */
  close(): void {
    if (this.timer) clearTimeout(this.timer)
    const content = this.content
    if (!this.discarded && !this.conflict && content !== this.saved) {
      vaultClient
        .write(this.path, content, { expectedVersion: this.version, amendReason: this.amendReason ?? undefined })
        .catch(console.error)
    }
    this.discarded = true
    this.view.destroy()
  }
}
