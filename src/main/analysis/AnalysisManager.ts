import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  ENVIRONMENT_FILE,
  environmentPython,
  type AnalysisStatus,
  type EnvironmentStamp,
  type PythonFound
} from '@shared/analysis/environment'
import type { CellResult } from '@shared/analysis/results'
import { attachmentFolder } from '@shared/attachments/attachments'
import type { Settings } from '@shared/settings/schema'
import { VaultError } from '@shared/vault/errors'
import { dirname, isInside, joinPath } from '@shared/vault/paths'
import type { VaultPath } from '@shared/vault/types'
import { LocalFsProvider } from '../vault/LocalFsProvider'
import type { VaultManager } from '../vault/VaultManager'
import { currentStamp, ensureEnvironment, readStamp, sha256, type EnvironmentPlace } from './environment'
import { findPython } from './python'
import { PythonRunner } from './runner'

export interface AnalysisOptions {
  vaults: VaultManager
  settings(): Settings
  /** Folder for per-vault environments, e.g. <userData>/envs. */
  envRoot(): string
  /** prem_runner.py on disk. */
  script(): Promise<string>
  onProgress(message: string): void
}

const windows = process.platform === 'win32'

/**
 * Runs the Python cells of notes: finds Python, keeps each vault's environment built from its
 * environment.txt, and keeps one runner per note so a note's cells share variables.
 */
export class AnalysisManager {
  private found: { setting: string; result: Promise<PythonFound> } | null = null
  private runners = new Map<VaultPath, { runner: PythonRunner; python: string; scratch: string | null }>()
  private space: string | null = null
  private preparing: Promise<unknown> | null = null

  constructor(private readonly options: AnalysisOptions) {}

  private python(refresh = false): Promise<PythonFound> {
    const setting = this.options.settings()['analysis.python']
    if (refresh || !this.found || this.found.setting !== setting) this.found = { setting, result: findPython(setting) }
    return this.found.result
  }

  /** The open vault: an id for its environment folder, and its folder on disk if it's local. */
  private vault(): { id: string; local: string | null } {
    const provider = this.options.vaults.current
    const id = sha256(provider.root).slice(0, 16)
    // Another vault was opened: the old one's runners hold its variables and working folders.
    if (this.space !== id) {
      this.stopAll()
      this.space = id
    }
    return { id, local: provider instanceof LocalFsProvider ? provider.root : null }
  }

  private async place(): Promise<EnvironmentPlace> {
    const { id } = this.vault()
    const provider = this.options.vaults.current
    const requirements = (await provider.exists(ENVIRONMENT_FILE))
      ? (await provider.read(ENVIRONMENT_FILE)).content
      : null
    return { dir: path.join(this.options.envRoot(), id), requirements: requirements?.trim() ? requirements : null }
  }

  async status(refresh = false): Promise<AnalysisStatus> {
    const python = await this.python(refresh)
    if (!this.options.vaults.isOpen)
      return python.python
        ? { python, requirements: false, environment: { state: 'missing', requirements: false } }
        : { python, requirements: false, environment: { state: 'unavailable', problem: python.problem! } }
    const place = await this.place()
    const requirements = place.requirements !== null
    if (!python.python) return { python, requirements, environment: { state: 'unavailable', problem: python.problem! } }
    if (!requirements) return { python, requirements, environment: { state: 'missing', requirements } }
    const stamp = await currentStamp(place, windows)
    if (stamp) return { python, requirements, environment: { state: 'ready', stamp } }
    const built = await readStamp(place.dir)
    return { python, requirements, environment: { state: built ? 'outdated' : 'missing', requirements } }
  }

  /** Builds or updates the vault's environment from environment.txt. */
  async prepare(): Promise<AnalysisStatus> {
    const place = await this.place()
    if (place.requirements) await this.prepareFor(place, await this.python(true))
    return this.status()
  }

  /** Runs one cell of a note. Refused for locked notes and when running Python is turned off in Settings. */
  async run(notePath: VaultPath, code: string): Promise<CellResult> {
    const settings = this.options.settings()
    if (!settings['analysis.enabled'])
      throw new VaultError('FORBIDDEN', 'Running Python is turned off in Settings → Analysis.')
    if ((await this.options.vaults.recordStatus(notePath)).locked)
      throw new VaultError('LOCKED', 'This note is signed, so its cells can no longer be run. Amend it first.')

    const { local } = this.vault()
    const found = await this.python()
    if (!found.python) throw new VaultError('UNKNOWN', found.problem ?? 'Python was not found')

    // With an environment.txt, cells run in the vault's environment, built first if needed.
    const place = await this.place()
    let python = found.python
    let environment: string | null = null
    if (place.requirements) {
      const stamp = await this.prepareFor(place, found)
      python = environmentPython(place.dir, windows)
      environment = stamp.id
    }

    const entry = await this.runnerFor(notePath, python)
    const folder = dirname(notePath)
    let cwd: string
    let root: string
    if (local) {
      cwd = path.join(local, ...folder.split('/').filter(Boolean))
      root = local
    } else {
      cwd = await this.copyAttachments(notePath, entry)
      root = cwd
    }

    const ranAt = new Date().toISOString()
    const timeout = settings['analysis.timeout'] * 1000
    const pythonVersion = await entry.runner.start()
    const reply = await entry.runner.run(code, cwd, root, timeout)
    return {
      ...reply,
      // On a team vault the copy holds the note's folder layout, so paths map back the same way.
      inputs: reply.inputs.map((i) => ({ ...i, path: local ? i.path : joinPath(folder, i.path) })),
      ranAt,
      pythonVersion,
      environment
    }
  }

  /** The environment for environment.txt as it is now, building it first if needed. */
  private async prepareFor(place: EnvironmentPlace, found: PythonFound): Promise<EnvironmentStamp> {
    const ready = await currentStamp(place, windows)
    if (ready) return ready
    if (!this.preparing) {
      this.preparing = ensureEnvironment(place, found, this.options.onProgress).finally(() => {
        this.preparing = null
      })
    }
    await this.preparing
    // Runners started before the update still have the old packages loaded.
    this.stopAll()
    const stamp = await currentStamp(place, windows)
    if (!stamp) throw new VaultError('UNKNOWN', 'The Python environment could not be set up.')
    return stamp
  }

  private async runnerFor(notePath: VaultPath, python: string) {
    const existing = this.runners.get(notePath)
    if (existing && existing.python === python) return existing
    if (existing) this.stop(notePath)
    const entry = { runner: new PythonRunner(python, await this.options.script()), python, scratch: null }
    this.runners.set(notePath, entry)
    return entry
  }

  /**
   * On a team vault, code runs on this computer against a copy of the note's attachments, so
   * `pd.read_csv("attachments/plate.csv")` works the same as in a local vault. Refreshed before each cell.
   */
  private async copyAttachments(notePath: VaultPath, entry: { scratch: string | null }): Promise<string> {
    entry.scratch ??= await mkdtemp(path.join(tmpdir(), 'prem-analysis-'))
    const provider = this.options.vaults.current
    const folder = attachmentFolder(notePath)
    const base = dirname(notePath)
    for (const e of await provider.list()) {
      if (e.kind !== 'file' || !isInside(e.path, folder)) continue
      const rel = base ? e.path.slice(base.length + 1) : e.path
      const target = path.join(entry.scratch, ...rel.split('/'))
      await mkdir(path.dirname(target), { recursive: true })
      await writeFile(target, await provider.readBinary(e.path))
    }
    return entry.scratch
  }

  /** Stops the running cell of a note, keeping its variables where possible. */
  interrupt(notePath: VaultPath): void {
    this.runners.get(notePath)?.runner.interrupt()
  }

  /** Ends a note's runner, forgetting its variables. */
  stop(notePath: VaultPath): void {
    const entry = this.runners.get(notePath)
    if (!entry) return
    entry.runner.kill()
    if (entry.scratch) void rm(entry.scratch, { recursive: true, force: true })
    this.runners.delete(notePath)
  }

  stopAll(): void {
    // Deleting from a Map while iterating it is safe.
    for (const notePath of this.runners.keys()) this.stop(notePath)
  }
}
