import type { EditorView } from '@codemirror/view'
import { codeHash, outputChange, outputFiles, parseOutputBody, renderOutput } from '@shared/analysis/cells'
import { compareOutput, type CellComparison, type EnvironmentReport } from '@shared/analysis/reproduce'
import { resolveAttachment } from '@shared/attachments/attachments'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { currentSettings } from '../../state/SettingsContext'
import {
  cellsField,
  cellStates,
  recordedInputs,
  setCellState,
  setInputHashes,
  type AnalysisHost
} from './extensions/analysisCells'

let nextId = 1

const posOf = (view: EditorView, id: number): number | undefined =>
  view.state.field(cellStates).find((s) => s.id === id)?.pos
/** Notes whose code, last changed by someone else, you've agreed to run this session. */
const trusted = new Set<string>()

/** What Reproduce found: how the environment compares, then each cell's rerun against its recorded output. */
export interface ReproduceReport {
  environment: EnvironmentReport
  cells: { label: string; comparison: CellComparison | null }[]
}

export interface CellRunner extends AnalysisHost {
  /** Restarts Python for the note and runs every cell in order, stopping at the first that fails. */
  runAll(view: EditorView): Promise<void>
  /** Looks up the files the note's outputs read, to flag outputs whose inputs changed since. */
  refreshInputs(view: EditorView): Promise<void>
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

/** Looks up the files the note's outputs read, so outputs whose inputs changed since are flagged. */
async function refreshInputs(view: EditorView): Promise<void> {
  const paths = recordedInputs(view.state)
  const hashes = paths.length ? await vaultClient.inputHashes(paths).catch(() => ({})) : {}
  try {
    view.dispatch({ effects: setInputHashes.of(hashes) })
  } catch {
    // The note was closed meanwhile.
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
  /** Shows what Reproduce found, or why it couldn't run. */
  onReport(report: ReproduceReport | { error: string }): void
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
      void refreshInputs(view)
      return result.ok
    } catch (err) {
      update(view, id, 'failed', errorMessage(err))
      return false
    } finally {
      off()
    }
  }

  /** Reruns the cells up to `from` in a fresh Python and the recorded environment, and compares the outputs. */
  const reproduce = async (view: EditorView, from: number): Promise<void> => {
    const all = view.state.field(cellsField)
    const upTo = all.findIndex((c) => c.from === from)
    if (upTo < 0) return
    const cells = all.slice(0, upTo + 1).filter((c) => c.code.trim())
    const target = all[upTo]
    const environment = target.output?.meta?.env ?? cells.find((c) => c.output?.meta?.env)?.output?.meta?.env ?? null
    const id = nextId++
    view.dispatch({
      effects: setCellState.of({ id, state: { id, pos: from, state: 'running', message: 'Reproducing…' } })
    })
    const off = vaultClient.onAnalysisProgress((m) => update(view, id, 'running', `Rebuilding the environment: ${m}`))
    try {
      const recorded = cells.map((c) => (c.output ? view.state.sliceDoc(c.output.from, c.output.to) : null))
      const { environment: env, results } = await vaultClient.reproduce(
        path,
        cells.map((c) => c.code),
        environment
      )
      const files = new Map<string, Uint8Array | null>()
      for (const block of recorded) {
        for (const part of block ? parseOutputBody(block) : []) {
          if (part.kind !== 'file' || files.has(part.url)) continue
          const file = resolveAttachment(path, part.url)
          files.set(part.url, file ? await vaultClient.readBinary(file).catch(() => null) : null)
        }
      }
      options.onReport({
        environment: env,
        cells: cells.map((c, i) => ({
          label:
            c.code
              .split('\n')
              .find((l) => l.trim())
              ?.trim() ?? '',
          comparison:
            recorded[i] && results[i]
              ? compareOutput(
                  recorded[i]!,
                  c.output!.meta,
                  (url) => files.get(url) ?? null,
                  results[i],
                  codeHash(c.code)
                )
              : null
        }))
      })
      update(view, id, null)
      void refreshInputs(view)
    } catch (err) {
      update(view, id, null)
      options.onReport({ error: errorMessage(err) })
    } finally {
      off()
    }
  }

  return {
    enabled: () => currentSettings()['analysis.enabled'],
    reproduce: (view, from) => void reproduce(view, from),
    refreshInputs,
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
