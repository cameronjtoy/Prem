import {
  EditorState,
  Facet,
  Prec,
  StateEffect,
  StateField,
  type Extension,
  type Range,
  type Transaction
} from '@codemirror/state'
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view'
import { codeHash, describeMeta, findCells, parseOutputBody, type Cell, type OutputMeta } from '@shared/analysis/cells'
import { changedInputs, describeChangedInputs } from '@shared/analysis/reproduce'
import { AttachmentWidget } from './attachments'
import { hostFacet } from './host'

/** What the note editor does for cells. */
export interface AnalysisHost {
  /** Whether Run is offered at all (Settings → Analysis). */
  enabled(): boolean
  /** Why cells can't run in this note right now, or null if they can. */
  blocked(): string | null
  run(view: EditorView, cellFrom: number): void
  /** Reruns the cells up to this one in the recorded environment and compares with their outputs. */
  reproduce(view: EditorView, cellFrom: number): void
  stop(): void
  formatTime(iso: string): string
  /**
   * You edited a cell: `before` is what its code's place in the note held before the edit, `after` its code
   * now. Code you write yourself doesn't need approving; code that came from somewhere else still does after
   * you edit it.
   */
  edited(before: string, after: string): void
}

export const analysisHostFacet = Facet.define<AnalysisHost, AnalysisHost | null>({
  combine: (values) => values[0] ?? null
})

/** A cell that's running, or whose last run failed before it produced an output. */
export interface CellState {
  id: number
  /** Start of the cell's opening fence, kept in step with edits while it runs. */
  pos: number
  state: 'running' | 'failed'
  message: string
}

export const setCellState = StateEffect.define<{ id: number; state: CellState | null }>({
  map: (value, changes) =>
    value.state ? { ...value, state: { ...value.state, pos: changes.mapPos(value.state.pos) } } : value
})

/** Settings changed (e.g. Run turned off), so redraw the toolbars. */
export const refreshCells = StateEffect.define<null>()

/** The current sha256 of files the note's outputs read (null when gone), to flag outputs whose inputs changed. */
export const setInputHashes = StateEffect.define<Record<string, string | null>>()

export const inputHashes = StateField.define<Record<string, string | null>>({
  create: () => ({}),
  update: (hashes, tr) => {
    for (const e of tr.effects) if (e.is(setInputHashes)) return e.value
    return hashes
  }
})

/** Every file the note's outputs say they read. */
export function recordedInputs(state: EditorState): string[] {
  const paths = new Set<string>()
  for (const cell of state.field(cellsField)) for (const i of cell.output?.meta?.inputs ?? []) paths.add(i.path)
  return [...paths]
}

export const cellStates = StateField.define<CellState[]>({
  create: () => [],
  update(states, tr) {
    let next = tr.docChanged ? states.map((s) => ({ ...s, pos: tr.changes.mapPos(s.pos) })) : states
    for (const e of tr.effects) {
      if (!e.is(setCellState)) continue
      next = next.filter((s) => s.id !== e.value.id)
      if (e.value.state) next = [...next.filter((s) => s.pos !== e.value.state!.pos), e.value.state]
    }
    return next
  }
})

/** The run cells of the note, recomputed when the text changes. */
export const cellsField = StateField.define<Cell[]>({
  create: (state) => findCells(state.doc.toString()),
  update: (cells, tr) => (tr.docChanged ? findCells(tr.state.doc.toString()) : cells)
})

/** The cell whose code contains `pos`, if any. */
export function cellAt(state: EditorState, pos: number): Cell | undefined {
  return state.field(cellsField).find((c) => pos >= c.from && pos <= c.to)
}

class ToolbarWidget extends WidgetType {
  constructor(
    readonly from: number,
    readonly status: string,
    readonly running: boolean,
    readonly failed: boolean,
    readonly stale: boolean,
    readonly blocked: string | null,
    readonly reproducible: boolean
  ) {
    super()
  }

  eq(other: ToolbarWidget): boolean {
    return (
      other.from === this.from &&
      other.status === this.status &&
      other.running === this.running &&
      other.failed === this.failed &&
      other.stale === this.stale &&
      other.blocked === this.blocked &&
      other.reproducible === this.reproducible
    )
  }

  toDOM(view: EditorView): HTMLElement {
    const host = view.state.facet(analysisHostFacet)
    const bar = document.createElement('div')
    bar.className = 'cm-cell-bar'
    bar.dataset.cell = String(this.from)
    const button = document.createElement('button')
    button.className = this.running ? 'cm-cell-stop' : 'cm-cell-run'
    button.textContent = this.running ? '■ Stop' : '▶ Run'
    button.disabled = !this.running && !!this.blocked
    button.title = this.running ? 'Stop this cell' : (this.blocked ?? 'Run this cell (⇧↵ in the code)')
    button.addEventListener('mousedown', (e) => {
      e.preventDefault()
      if (this.running) host?.stop()
      else if (!this.blocked) host?.run(view, this.from)
    })
    bar.append(button)
    if (this.reproducible && !this.running) {
      const again = document.createElement('button')
      again.className = 'cm-cell-reproduce'
      again.textContent = '↻ Reproduce'
      again.title =
        'Rerun the cells up to here in the environment they recorded, and compare with these outputs. Nothing in the note changes.'
      again.addEventListener('mousedown', (e) => {
        e.preventDefault()
        host?.reproduce(view, this.from)
      })
      bar.append(again)
    }
    const label = document.createElement('span')
    label.className = `cm-cell-status${this.failed ? ' failed' : ''}${this.stale ? ' stale' : ''}`
    label.textContent = this.status
    bar.append(label)
    return bar
  }

  ignoreEvent(): boolean {
    return true
  }
}

class OutputWidget extends WidgetType {
  constructor(
    readonly block: string,
    readonly meta: OutputMeta | null,
    readonly stale: boolean,
    readonly from: number
  ) {
    super()
  }

  eq(other: OutputWidget): boolean {
    return other.block === this.block && other.stale === this.stale
  }

  toDOM(view: EditorView): HTMLElement {
    const files = view.state.facet(hostFacet)
    const host = view.state.facet(analysisHostFacet)
    const wrap = document.createElement('div')
    wrap.className = `cm-cell-output${this.stale ? ' stale' : ''}${this.meta && !this.meta.ok ? ' failed' : ''}`
    if (this.meta) {
      const line = document.createElement('div')
      line.className = 'cm-cell-meta'
      line.textContent = describeMeta(this.meta, (iso) => host?.formatTime(iso) ?? iso)
      line.title = 'Click to see this output as text'
      line.addEventListener('mousedown', (e) => {
        e.preventDefault()
        view.dispatch({ selection: { anchor: this.from + 1 } })
        view.focus()
      })
      wrap.append(line)
    }
    for (const part of parseOutputBody(this.block)) {
      if (part.kind === 'text') {
        const pre = document.createElement('pre')
        pre.className = `cm-cell-text ${part.stream}`
        pre.textContent = part.text
        wrap.append(pre)
      } else if (part.kind === 'file') {
        const path = files.resolveFile(part.url)
        if (!path) continue
        const holder = document.createElement('div')
        holder.className = 'cm-cell-file'
        holder.append(new AttachmentWidget(path, part.label).toDOM(view))
        if (part.label) {
          const caption = document.createElement('div')
          caption.className = 'cm-cell-caption'
          caption.textContent = part.label
          holder.append(caption)
        }
        wrap.append(holder)
      } else {
        const note = document.createElement('div')
        note.className = 'cm-cell-note'
        note.textContent = part.text
        wrap.append(note)
      }
    }
    return wrap
  }

  ignoreEvent(event: Event): boolean {
    // Let clicks reach attachments (open, scroll a table); everything else stays with the widget.
    return event.type !== 'mousedown' || !(event.target as HTMLElement).closest('.cm-attachment')
  }
}

function build(state: EditorState): DecorationSet {
  const host = state.facet(analysisHostFacet)
  if (!host?.enabled()) return Decoration.none
  const blocked = state.readOnly ? 'This note is read-only, so its cells can’t run.' : host.blocked()
  const states = state.field(cellStates)
  const hashes = state.field(inputHashes)
  let upstream = false
  // A cursor at the very start of an output (e.g. where it was just written) leaves it rendered.
  const touches = (from: number, to: number): boolean => state.selection.ranges.some((r) => r.from <= to && r.to > from)
  const decos: Range<Decoration>[] = []
  for (const cell of state.field(cellsField)) {
    const own = states.find((s) => s.pos === cell.from)
    const meta = cell.output?.meta ?? null
    const codeChanged = !!meta && meta.code !== codeHash(cell.code)
    const ownInputs = meta && !codeChanged ? describeChangedInputs(changedInputs(meta, hashes)) : ''
    // Later cells use what earlier ones computed, so a changed input upstream affects them too.
    const inputsChanged =
      ownInputs ||
      (meta && !codeChanged && upstream ? 'An earlier cell read a file that changed since this output.' : '')
    if (ownInputs) upstream = true
    const stale = codeChanged || !!inputsChanged
    const status = own
      ? own.message
      : codeChanged
        ? 'The code changed since this output. Run it again to update it.'
        : inputsChanged || (meta ? '' : 'Not run yet')
    decos.push(
      Decoration.widget({
        widget: new ToolbarWidget(
          cell.from,
          status,
          own?.state === 'running',
          own?.state === 'failed',
          stale,
          blocked,
          !!meta && !codeChanged
        ),
        block: true,
        side: -1
      }).range(cell.from)
    )
    if (cell.output) {
      const from = cell.output.from
      const to = state.doc.lineAt(Math.max(from, cell.output.to - 1)).to
      if (!touches(from, to)) {
        decos.push(
          Decoration.replace({
            widget: new OutputWidget(state.sliceDoc(from, to), meta, stale, from),
            block: true
          }).range(from, to)
        )
      }
    }
  }
  return Decoration.set(decos, true)
}

const cellDecorations = StateField.define<DecorationSet>({
  create: build,
  update(decos, tr) {
    if (
      tr.docChanged ||
      tr.selection ||
      tr.effects.some((e) => e.is(setCellState) || e.is(refreshCells) || e.is(setInputHashes)) ||
      tr.startState.readOnly !== tr.state.readOnly
    ) {
      return build(tr.state)
    }
    return decos
  },
  provide: (f) => EditorView.decorations.from(f)
})

/** Edits you make yourself (typing, deleting, pasting, dragging), as opposed to a file changed on disk. */
const byYou = (tr: Transaction): boolean =>
  tr.docChanged && (tr.isUserEvent('input') || tr.isUserEvent('delete') || tr.isUserEvent('move'))

/** Tells the host which cells you edited, and what they held before, so code you write yourself can run. */
const trackEdits = EditorView.updateListener.of((update) => {
  const host = update.state.facet(analysisHostFacet)
  if (!host) return
  for (const tr of update.transactions) {
    if (!byYou(tr)) continue
    const back = tr.changes.invertedDesc
    tr.changes.iterChangedRanges((_fromA, _toA, fromB, toB) => {
      for (const cell of tr.state.field(cellsField)) {
        if (cell.codeFrom > toB || cell.codeTo < fromB) continue
        host.edited(tr.startState.sliceDoc(back.mapPos(cell.codeFrom, -1), back.mapPos(cell.codeTo, 1)), cell.code)
      }
    })
  }
})

/** Run cells: a toolbar on each ```python {run} block, and its output shown below. */
export function analysisCells(host: AnalysisHost): Extension {
  return [analysisHostFacet.of(host), cellsField, cellStates, inputHashes, Prec.high(cellDecorations), trackEdits]
}
