import type { EditorView } from '@codemirror/view'
import { codeHash, outputChange, outputFiles, parseOutputBody, renderOutput } from '@shared/analysis/cells'
import { compareOutput, type CellComparison, type EnvironmentReport } from '@shared/analysis/reproduce'
import { resolveAttachment } from '@shared/attachments/attachments'
import { approvalText } from '@shared/analysis/trust'
import { errorMessage, vaultClient } from '../../services/vaultClient'
import { currentSettings } from '../../state/SettingsContext'
import type { RunApprovalRequest } from './ApproveRun'
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
/**
 * Cell code that's yours: approved on this computer, or written here by editing code that was. It still has
 * to be approved in the main process before it runs; this is what lets that happen without asking.
 */
const known = new Set<string>()
const isKnown = (code: string): boolean => !code.trim() || known.has(approvalText(code))

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
  /** Learns which of the note's cells are already approved, so editing them keeps them approved. */
  refreshTrust(view: EditorView): Promise<void>
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

/** Learns which of the note's cells are already approved, so editing them keeps them approved. */
async function refreshTrust(view: EditorView): Promise<void> {
  const codes = view.state.field(cellsField).map((c) => c.code)
  if (!codes.length) return
  const check = await vaultClient.checkRun(codes).catch(() => null)
  if (!check) return
  const untrusted = new Set(check.code)
  codes.forEach((c, i) => !untrusted.has(i) && c.trim() && known.add(approvalText(c)))
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
  /** Asks you to approve packages or code before they run. Resolves to whether you did. */
  approve(request: RunApprovalRequest): Promise<boolean>
  /** Shows a message, e.g. why cells couldn't run. */
  notify(message: string): void
  /** Shows what Reproduce found, or why it couldn't run. */
  onReport(report: ReproduceReport | { error: string }): void
}): CellRunner {
  const { path } = options

  /**
   * Makes sure these cells may run on this computer: code you wrote here is approved quietly, and anything
   * else (code from a teammate, a sync service or another program, or packages to install) is shown to you
   * first. Resolves to false if you said no.
   */
  const mayRun = async (codes: string[], reproduce?: { recorded: string | null }): Promise<boolean> => {
    const mine = codes.filter((c) => c.trim() && known.has(approvalText(c)))
    if (mine.length) await vaultClient.approveRun({ code: mine })
    const check = await vaultClient.checkRun(codes, reproduce && { notePath: path, recorded: reproduce.recorded })
    const code = [...new Set(check.code.map((i) => codes[i]))]
    if (!check.environment && !code.length) return true
    const history = code.length ? await vaultClient.history(path).catch(() => []) : []
    const ok = await options.approve({
      environment: check.environment,
      code,
      changedBy: history.length ? history[history.length - 1].author : null,
      you: options.author()
    })
    if (!ok) return false
    await vaultClient.approveRun({ environment: check.environment?.hash, code })
    for (const c of code) known.add(approvalText(c))
    return true
  }

  const runOne = async (view: EditorView, from: number, approved = false): Promise<boolean> => {
    const cell = view.state.field(cellsField).find((c) => c.from === from)
    if (!cell || !cell.code.trim()) return true
    try {
      if (!approved && !(await mayRun([cell.code]))) return false
    } catch (err) {
      options.notify(`Couldn't run the cell: ${errorMessage(err)}`)
      return false
    }
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
    try {
      if (
        !(await mayRun(
          cells.map((c) => c.code),
          { recorded: environment }
        ))
      )
        return
    } catch (err) {
      options.onReport({ error: errorMessage(err) })
      return
    }
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
    refreshTrust,
    edited: (before, after) => {
      if (isKnown(before) && after.trim()) known.add(approvalText(after))
    },
    blocked: () => null,
    formatTime,
    run: (view, from) => void runOne(view, from),
    stop: () => void vaultClient.interruptCell(path).catch(() => {}),
    restart: () => vaultClient.restartAnalysis(path),
    running: (view) => view.state.field(cellStates).some((s) => s.state === 'running'),
    async runAll(view) {
      // Everything that will run is approved together, before anything starts.
      try {
        if (!(await mayRun(view.state.field(cellsField).map((c) => c.code)))) return
      } catch (err) {
        options.notify(`Couldn't run the cells: ${errorMessage(err)}`)
        return
      }
      await vaultClient.restartAnalysis(path)
      for (let i = 0; ; i++) {
        const cell = view.state.field(cellsField)[i]
        if (!cell) return
        if (!(await runOne(view, cell.from, true))) return
      }
    }
  }
}
