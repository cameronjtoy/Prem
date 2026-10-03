import { createHash } from 'node:crypto'
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
import { formatLock, lockFileName, parseLock, type Reproduction } from '@shared/analysis/reproduce'
import type { CellResult } from '@shared/analysis/results'
import type { Approval, EnvironmentApproval, RunCheck } from '@shared/analysis/trust'
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
import { environmentApprovalHash, type TrustStore } from './trust'

export interface AnalysisOptions {
  vaults: VaultManager
  settings(): Settings
  /** Folder for per-vault environments, e.g. <userData>/envs. */
  envRoot(): string
  /** prem_runner.py on disk. */
  script(): Promise<string>
  /** What this computer has approved to install and run. */
  trust: TrustStore
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
  /** Environment lists shown for approval, by hash, so approving one can remember the vault's list. */
  private shown = new Map<string, EnvironmentApproval>()

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

  /**
   * What has to be approved before these cells can run: code not approved on this computer, and the
   * environment list if it would be installed and hasn't been. With `reproduce`, the environment is the one
   * Reproduce would rebuild for that note.
   */
  async check(codes: string[], reproduce?: { notePath: VaultPath; recorded: string | null }): Promise<RunCheck> {
    const { id } = this.vault()
    const code: number[] = []
    for (const [i, c] of codes.entries()) if (c.trim() && !(await this.options.trust.hasCode(id, c))) code.push(i)
    const lock = reproduce ? await this.savedLock(reproduce.notePath, reproduce.recorded) : null
    const environment = lock
      ? await this.approvalFor(lock.place, lock.file, false)
      : await this.approvalFor(await this.place(), ENVIRONMENT_FILE, true)
    if (environment) this.shown.set(environment.hash, environment)
    return { environment, code }
  }

  /** Records what was approved in the dialog. */
  async approve(approval: Approval): Promise<void> {
    const { id } = this.vault()
    const shown = approval.environment ? this.shown.get(approval.environment) : undefined
    await this.options.trust.approve(id, {
      environment: approval.environment,
      environmentText: shown?.file === ENVIRONMENT_FILE ? shown.text : undefined,
      code: approval.code
    })
  }

  /** The approval an environment list needs before it's installed, or null if it's built already or approved. */
  private async approvalFor(place: EnvironmentPlace, file: string, vaultList: boolean) {
    if (!place.requirements || (await currentStamp(place, windows))) return null
    const { id } = this.vault()
    const hash = environmentApprovalHash(place.requirements)
    if (await this.options.trust.hasEnvironment(id, hash)) return null
    const approval: EnvironmentApproval = {
      file,
      hash,
      text: place.requirements,
      previous: vaultList ? await this.options.trust.lastEnvironment(id) : null,
      changedBy: await this.lastAuthor(file)
    }
    return approval
  }

  /** Refuses to install an environment list that wasn't approved on this computer. */
  private async requireApproved(place: EnvironmentPlace, file: string): Promise<void> {
    if (!place.requirements?.trim()) return
    if (!(await this.options.trust.hasEnvironment(this.vault().id, environmentApprovalHash(place.requirements))))
      throw new VaultError('NEEDS_APPROVAL', `${file} has changed, so it needs approving before it's installed.`)
  }

  /** Refuses to run code that wasn't approved on this computer. */
  private async requireCode(codes: string[]): Promise<void> {
    const { id } = this.vault()
    for (const code of codes)
      if (code.trim() && !(await this.options.trust.hasCode(id, code)))
        throw new VaultError('NEEDS_APPROVAL', 'This code needs approving before it runs on this computer.')
  }

  /** Who changed a file last: a name, '' for a change made outside Prem, or null if there's no history. */
  private async lastAuthor(file: VaultPath): Promise<string | null> {
    try {
      const history = await this.options.vaults.history(file)
      return history.length ? history[history.length - 1].author : null
    } catch {
      return null
    }
  }

  /** Runs one cell of a note. Refused for locked notes and when running Python is turned off in Settings. */
  async run(notePath: VaultPath, code: string): Promise<CellResult> {
    const settings = this.options.settings()
    if (!settings['analysis.enabled'])
      throw new VaultError('FORBIDDEN', 'Running Python is turned off in Settings → Analysis.')
    if ((await this.options.vaults.recordStatus(notePath)).locked)
      throw new VaultError('LOCKED', 'This note is signed, so its cells can no longer be run. Amend it first.')

    await this.requireCode([code])
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
    const result = await this.runIn(entry, notePath, code, environment)
    if (environment && place.requirements) await this.saveLock(notePath, (await currentStamp(place, windows))!)
    return result
  }

  /** Runs code in a runner, in the note's folder (or a copy of its attachments on a team vault). */
  private async runIn(
    entry: { runner: PythonRunner; scratch: string | null },
    notePath: VaultPath,
    code: string,
    environment: string | null
  ): Promise<CellResult> {
    const { local } = this.vault()
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
    const timeout = this.options.settings()['analysis.timeout'] * 1000
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

  /**
   * Saves the environment's full package list next to the note, once, so the output's `env=` can always be
   * rebuilt exactly. A note in a folder you can't add files to just goes without; the run still counts.
   */
  private async saveLock(notePath: VaultPath, stamp: EnvironmentStamp): Promise<void> {
    const provider = this.options.vaults.current
    const file = joinPath(attachmentFolder(notePath), lockFileName(stamp.id))
    try {
      if (await provider.exists(file)) return
      await provider.writeBinary(file, new TextEncoder().encode(formatLock(stamp)), { createOnly: true })
    } catch {
      // EXISTS from a race, or no permission: either way there's nothing more to do.
    }
  }

  /** The sha256 of each file, or null for one that's gone. For flagging outputs whose inputs changed. */
  async inputHashes(paths: VaultPath[]): Promise<Record<string, string | null>> {
    const provider = this.options.vaults.current
    const hashes: Record<string, string | null> = {}
    for (const p of paths.slice(0, 500)) {
      try {
        hashes[p] = createHash('sha256')
          .update(await provider.readBinary(p))
          .digest('hex')
      } catch {
        hashes[p] = null
      }
    }
    return hashes
  }

  /**
   * Reruns a note's cells from the start in a fresh Python, in the environment their outputs recorded,
   * rebuilt from the saved package list. Nothing is written to the note: the caller compares the results.
   * Signed notes can be reproduced too, since nothing changes.
   */
  async reproduce(notePath: VaultPath, codes: string[], recorded: string | null): Promise<Reproduction> {
    if (!this.options.settings()['analysis.enabled'])
      throw new VaultError('FORBIDDEN', 'Running Python is turned off in Settings → Analysis.')
    await this.requireCode(codes)
    const found = await this.python()
    if (!found.python) throw new VaultError('UNKNOWN', found.problem ?? 'Python was not found')
    const { python, environment } = await this.environmentFor(notePath, recorded, found)
    const entry = { runner: new PythonRunner(python, await this.options.script()), scratch: null as string | null }
    try {
      const results: CellResult[] = []
      for (const code of codes) results.push(await this.runIn(entry, notePath, code, environment.used))
      return { environment, results }
    } finally {
      entry.runner.kill()
      if (entry.scratch) void rm(entry.scratch, { recursive: true, force: true })
    }
  }

  /** The environment to reproduce in: the recorded one rebuilt from its saved list, else the best available. */
  private async environmentFor(notePath: VaultPath, recorded: string | null, found: PythonFound) {
    const saved = await this.savedLock(notePath, recorded)
    if (recorded && saved) {
      const { lock, place } = saved
      const dir = place.dir
      if (!(await currentStamp(place, windows))) await this.requireApproved(place, saved.file)
      let stamp: EnvironmentStamp
      try {
        // With uv, ask for the recorded Python version; uv uses one already on this computer.
        const wanted = found.uv && lock.python ? { ...found, python: lock.python } : found
        stamp = await ensureEnvironment(place, wanted, this.options.onProgress)
      } catch (err) {
        if (!found.uv || !lock.python) throw err
        stamp = await ensureEnvironment(place, found, this.options.onProgress)
      }
      const exact = stamp.id === recorded
      const summary = exact
        ? `Rebuilt environment ${recorded} exactly (Python ${stamp.pythonVersion}, from ${lockFileName(recorded)}).`
        : `Rebuilt from ${lockFileName(recorded)}, but it isn't identical: Python ${stamp.pythonVersion} here` +
          (lock.python && lock.python !== stamp.pythonVersion ? ` (the original used ${lock.python})` : '') +
          `, environment ${stamp.id}. Differences may come from that.`
      return {
        python: environmentPython(dir, windows),
        environment: { recorded, used: stamp.id, exact, summary }
      }
    }

    // No saved list: outputs from before Prem saved them, or no environment.txt when they ran.
    const place = await this.place()
    if (place.requirements) {
      const stamp = await this.prepareFor(place, found)
      const exact = stamp.id === recorded
      const summary = recorded
        ? exact
          ? `Ran in the vault's environment, which is still ${recorded}.`
          : `Environment ${recorded} wasn't saved with this note, so this ran in the vault's current environment (${stamp.id}).`
        : `The outputs didn't record an environment, so this ran in the vault's current one (${stamp.id}).`
      return {
        python: environmentPython(place.dir, windows),
        environment: { recorded, used: stamp.id, exact, summary }
      }
    }
    const summary = recorded
      ? `Environment ${recorded} wasn't saved with this note, and the vault has no environment.txt, so this ran in Python ${found.version ?? ''} on this computer.`
      : `The vault has no environment.txt, so this ran in Python ${found.version ?? ''} on this computer, with whatever it has installed. Add an environment.txt to make reruns exact.`
    return { python: found.python!, environment: { recorded, used: null, exact: !recorded, summary } }
  }

  /** The package list saved with a note for the environment its outputs recorded, if there is one. */
  private async savedLock(notePath: VaultPath, recorded: string | null) {
    if (!recorded) return null
    const provider = this.options.vaults.current
    const file = joinPath(attachmentFolder(notePath), lockFileName(recorded))
    if (!(await provider.exists(file))) return null
    const lock = parseLock(new TextDecoder().decode(await provider.readBinary(file)))
    const place: EnvironmentPlace = {
      dir: path.join(this.options.envRoot(), 'locked', recorded),
      requirements: lock.requirements
    }
    return { file, lock, place }
  }

  /** The environment for environment.txt as it is now, building it first if needed. */
  private async prepareFor(place: EnvironmentPlace, found: PythonFound): Promise<EnvironmentStamp> {
    const ready = await currentStamp(place, windows)
    if (ready) return ready
    await this.requireApproved(place, ENVIRONMENT_FILE)
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
