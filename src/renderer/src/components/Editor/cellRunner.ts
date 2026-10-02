import type { EditorView } from '@codemirror/view'
import { codeHash, outputChange, outputFiles, renderOutput } from '@shared/analysis/cells'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { currentSettings } from '../../state/SettingsContext'
import { cellsField, cellStates, setCellState, type AnalysisHost } from './extensions/analysisCells'

let nextId = 1

const posOf = (view: EditorView, id: number): number | undefined =>
  view.state.field(cellStates).find((s) => s.id === id)?.pos
/** Notes whose code, last changed by someone else, you've agreed to run this session. */
const trusted = new Set<string>()

export interface CellRunner extends AnalysisHost {
  /** Restarts Python for the note and runs every cell in order, stopping at the first that fails. */
  runAll(view: EditorView): Promise<void>
  restart(): Promise<void>
  running(view: EditorView): boolean
}

/** Shows a running or failed state on a cell, wherever the cell is now. */
function update(view: EditorView, id: number, state: 'running' | 'failed' | null, message = ''): void {
  const pos = posOf(view, id)
  if (pos === undefined && state) return
  try {
    view.dispatch({
      effects: setCellState.of({ id, state: state ? { id, pos: pos!, state, message } : null })
    })
  } catch {
    // The note was closed while the cell ran.
  }
}

const formatTime = (iso: string): string => {
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Runs a note's cells and writes their outputs into the note. Outputs are ordinary edits, so they're saved,
 * kept in history and covered by signing like anything else in the note.
 */
export function createCellRunner(options: {
  path: string
  /** Your name, recorded with each output. */
  author(): string
  /** True on a team vault, where others may have written the code. */
  shared(): boolean
}): CellRunner {
  const { path } = options

  /** On a team vault, asks before running code someone else wrote last, once per note per session. */
  const mayRun = async (): Promise<boolean> => {
    if (!options.shared() || trusted.has(path)) return true
    const history = await vaultClient.history(path).catch(() => [])
    const last = history[history.length - 1]?.author
    if (last && last !== options.author()) {
      const ok = window.confirm(
        `${last} changed this note last. Its code will run on your computer, with access to your files. Run it?`
      )
      if (!ok) return false
    }
    trusted.add(path)
    return true
  }

  const runOne = async (view: EditorView, from: number): Promise<boolean> => {
    const cell = view.state.field(cellsField).find((c) => c.from === from)
    if (!cell || !cell.code.trim()) return true
    if (!(await mayRun())) return false
    const id = nextId++
    view.dispatch({ effects: setCellState.of({ id, state: { id, pos: from, state: 'running', message: 'Running…' } }) })
    const off = vaultClient.onAnalysisProgress((m) => update(view, id, 'running', `Setting up Python: ${m}`))
    try {
      const hash = codeHash(cell.code)
      const result = await vaultClient.runCell(path, cell.code)
      const links: string[] = []
      for (const file of outputFiles(result.outputs, hash)) {
        links.push((await vaultClient.addAttachment(path, file.name, file.data)).markdown)
      }
      const block = renderOutput(
        result,
        {
          code: hash,
          ran: result.ranAt,
          by: options.author(),
          took: Math.round(result.duration * 10) / 10,
          python: result.pythonVersion,
          env: result.environment,
          inputs: result.inputs
        },
        links
      )
      // The note may have changed while the cell ran; the cell is found again where it is now.
      const pos = posOf(view, id)
      const target = view.state.field(cellsField).find((c) => c.from === pos)
      view.dispatch({
        changes: target ? outputChange(view.state.doc.toString(), target, block) : undefined,
        effects: setCellState.of({ id, state: null })
      })
      return result.ok
    } catch (err) {
      update(view, id, 'failed', errorMessage(err))
      return false
    } finally {
      off()
    }
  }

  return {
    enabled: () => currentSettings()['analysis.enabled'],
    blocked: () => null,
    formatTime,
    run: (view, from) => void runOne(view, from),
    stop: () => void vaultClient.interruptCell(path).catch(() => {}),
    restart: () => vaultClient.restartAnalysis(path),
    running: (view) => view.state.field(cellStates).some((s) => s.state === 'running'),
    async runAll(view) {
      await vaultClient.restartAnalysis(path)
      for (let i = 0; ; i++) {
        const cell = view.state.field(cellsField)[i]
        if (!cell) return
        if (!(await runOne(view, cell.from))) return
      }
    }
  }
}
