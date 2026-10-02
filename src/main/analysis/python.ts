import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import type { PythonFound } from '@shared/analysis/environment'

const PROBE_TIMEOUT_MS = 10_000

/** Runs a program and returns its trimmed output, or null if it can't be run or fails. */
export function probe(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(command, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (err, stdout) =>
      resolve(err ? null : stdout.toString().trim())
    )
  })
}

const VERSION = ['-c', 'import sys; print(sys.version.split()[0])']

async function exists(file: string): Promise<boolean> {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** uv on PATH, or where its installer puts it (apps started from the Dock don't get the shell's PATH). */
async function findUv(windows: boolean): Promise<string | null> {
  const exe = windows ? 'uv.exe' : 'uv'
  const candidates = ['uv', path.join(homedir(), '.local', 'bin', exe), path.join(homedir(), '.cargo', 'bin', exe)]
  if (!windows) candidates.push('/opt/homebrew/bin/uv', '/usr/local/bin/uv')
  for (const candidate of candidates) {
    if (candidate !== 'uv' && !(await exists(candidate))) continue
    if (await probe(candidate, ['--version'])) return candidate
  }
  return null
}

/**
 * Finds the Python to build environments with: the one chosen in settings, else the one uv manages, else
 * python3 (or `py -3` on Windows). Never installs anything.
 */
export async function findPython(setting: string, platform = process.platform): Promise<PythonFound> {
  const windows = platform === 'win32'
  const uv = await findUv(windows)
  const found = async (python: string, source: PythonFound['source']): Promise<PythonFound | null> => {
    const version = await probe(python, VERSION)
    return version ? { python, version, uv, source, problem: null } : null
  }

  if (setting.trim()) {
    return (
      (await found(setting.trim(), 'setting')) ?? {
        python: null,
        version: null,
        uv,
        source: null,
        problem: `The Python chosen in Settings (${setting.trim()}) didn't run. Check the path, or clear it to let Prem look.`
      }
    )
  }
  if (uv) {
    const managed = await probe(uv, ['python', 'find'])
    const result = managed && (await found(managed, 'uv'))
    if (result) return result
  }
  const candidates: [string, string[]][] = windows
    ? [
        ['py', ['-3']],
        ['python', []]
      ]
    : [
        ['python3', []],
        ['python', []],
        ['/opt/homebrew/bin/python3', []],
        ['/usr/local/bin/python3', []]
      ]
  for (const [command, prefix] of candidates) {
    const where = await probe(command, [...prefix, '-c', 'import sys; print(sys.executable)'])
    const result = where && (await found(where, 'path'))
    if (result) return result
  }
  return {
    python: null,
    version: null,
    uv,
    source: null,
    problem: uv
      ? 'uv is installed but has no Python yet. Run "uv python install" in a terminal, then try again.'
      : 'Prem could not find Python. Install Python 3 from python.org, or uv from docs.astral.sh/uv, then try again.'
  }
}
