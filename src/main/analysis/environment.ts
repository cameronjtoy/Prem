import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildSteps,
  environmentPython,
  errorTail,
  isCurrent,
  type EnvironmentStamp,
  type PythonFound
} from '@shared/analysis/environment'

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

const STAMP = 'prem-env.json'
const INSTALL_TIMEOUT_MS = 20 * 60_000

export interface EnvironmentPlace {
  /** Folder holding this vault's environment. */
  dir: string
  /** environment.txt's text, or null when the vault has none. */
  requirements: string | null
}

export async function readStamp(dir: string): Promise<EnvironmentStamp | null> {
  try {
    return JSON.parse(await readFile(path.join(dir, STAMP), 'utf8')) as EnvironmentStamp
  } catch {
    return null
  }
}

/** The environment's stamp if it's built and still matches environment.txt, else null. */
export async function currentStamp(place: EnvironmentPlace, windows: boolean): Promise<EnvironmentStamp | null> {
  const stamp = await readStamp(place.dir)
  if (!isCurrent(stamp, sha256(place.requirements ?? ''))) return null
  try {
    await access(environmentPython(place.dir, windows))
    return stamp
  } catch {
    return null
  }
}

function run(command: string, args: string[], onLine: (line: string) => void): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: true, // uv may only use a Python already on this computer: Prem never downloads tools itself.
      env: { ...process.env, PIP_NO_INPUT: '1', UV_PYTHON_DOWNLOADS: 'never' }
    })
    let output = ''
    const take = (chunk: Buffer): void => {
      const text = chunk.toString()
      output += text
      for (const line of text.split(/\r?\n/)) if (line.trim()) onLine(line.trim())
    }
    child.stdout.on('data', take)
    child.stderr.on('data', take)
    const timer = setTimeout(() => child.kill(), INSTALL_TIMEOUT_MS)
    child.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(output)
      else reject(new Error(errorTail(output) || `${path.basename(command)} stopped with code ${code}`))
    })
  })
}

/**
 * Builds the vault's environment if it's missing or environment.txt changed since it was built, and returns
 * its stamp. `onProgress` gets a short label for each step and the tool's output lines.
 */
export async function ensureEnvironment(
  place: EnvironmentPlace,
  found: PythonFound,
  onProgress: (message: string) => void,
  windows = process.platform === 'win32'
): Promise<EnvironmentStamp> {
  const current = await currentStamp(place, windows)
  if (current) return current
  if (!found.python) throw new Error(found.problem ?? 'Python was not found')

  await rm(place.dir, { recursive: true, force: true })
  await mkdir(path.dirname(place.dir), { recursive: true })
  const requirementsFile = place.requirements ? `${place.dir}.requirements.txt` : null
  if (requirementsFile) await writeFile(requirementsFile, place.requirements!, 'utf8')
  const tool = found.uv ? 'uv' : 'venv'
  try {
    for (const step of buildSteps({
      tool,
      python: found.python,
      uv: found.uv,
      dir: place.dir,
      requirements: requirementsFile,
      windows
    })) {
      onProgress(step.label)
      await run(step.command, step.args, onProgress)
    }
    const envPython = environmentPython(place.dir, windows)
    const packages = (await run(envPython, ['-m', 'pip', 'freeze', '--disable-pip-version-check'], () => {})).trim()
    const version = (await run(envPython, ['-c', 'import sys; print(sys.version.split()[0])'], () => {})).trim()
    const stamp: EnvironmentStamp = {
      requirementsHash: sha256(place.requirements ?? ''),
      tool,
      pythonVersion: version,
      packages,
      id: sha256(`${version}\n${packages}`).slice(0, 12),
      created: new Date().toISOString()
    }
    await writeFile(path.join(place.dir, STAMP), JSON.stringify(stamp, null, 2), 'utf8')
    return stamp
  } catch (err) {
    // Half-built environments are worse than none: the next attempt starts clean.
    await rm(place.dir, { recursive: true, force: true })
    throw err
  } finally {
    if (requirementsFile) await rm(requirementsFile, { force: true })
  }
}
