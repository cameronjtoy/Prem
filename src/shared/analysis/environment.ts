// The Python environment for a vault: which tool builds it, from what, and when it needs rebuilding.
//
// Each vault gets one environment, made from `environment.txt` at the vault root (pip's requirements format;
// optional). It lives in Prem's own settings folder, never in the vault, so nothing large is synced.

/** The file in a vault that lists the Python packages its analyses need. */
export const ENVIRONMENT_FILE = 'environment.txt'

/** Packages a new environment.txt starts with, when someone asks for one. */
export const STARTER_ENVIRONMENT = `# Python packages this vault's analyses use, one per line (pip's requirements format).
# Pin versions, e.g. pandas==2.2.3, so every computer in the lab gets the same results.
numpy
pandas
matplotlib
`

export type EnvironmentTool = 'uv' | 'venv'

/** How Prem found Python on this computer. */
export interface PythonFound {
  /** The Python used to make environments (or run directly when uv isn't used). */
  python: string | null
  version: string | null
  /** uv, when installed. Used to make environments and install packages. */
  uv: string | null
  /** Where Python came from. */
  source: 'setting' | 'uv' | 'path' | null
  /** Why nothing was found, in words for the person. */
  problem: string | null
}

/** What's recorded about a built environment, in `prem-env.json` next to it. */
export interface EnvironmentStamp {
  /** sha256 of environment.txt when the environment was built, or of "" when there was none. */
  requirementsHash: string
  tool: EnvironmentTool
  pythonVersion: string
  /** `pip freeze`: every installed package and its version. */
  packages: string
  /** sha256 of `packages`, shortened: what an output records as `env=`. */
  id: string
  created: string
}

export interface AnalysisStatus {
  python: PythonFound
  /** Whether the vault has an environment.txt. */
  requirements: boolean
  environment: EnvironmentState
}

export type EnvironmentState =
  | { state: 'unavailable'; problem: string }
  | { state: 'missing' | 'outdated'; requirements: boolean }
  | { state: 'ready'; stamp: EnvironmentStamp }

/** True when an environment built with `stamp` still matches the vault's environment.txt. */
export function isCurrent(stamp: EnvironmentStamp | null, requirementsHash: string): boolean {
  return !!stamp && stamp.requirementsHash === requirementsHash
}

/** The Python inside an environment folder. */
export function environmentPython(dir: string, windows: boolean): string {
  return windows ? `${dir}\\Scripts\\python.exe` : `${dir}/bin/python`
}

export interface Step {
  /** Shown while it runs, e.g. "Installing packages". */
  label: string
  command: string
  args: string[]
}

/** The commands that build an environment, in order. */
export function buildSteps(options: {
  tool: EnvironmentTool
  python: string
  uv: string | null
  dir: string
  requirements: string | null
  windows: boolean
}): Step[] {
  const { tool, python, uv, dir, requirements, windows } = options
  const envPython = environmentPython(dir, windows)
  if (tool === 'uv' && uv) {
    const steps: Step[] = [
      { label: 'Creating the environment', command: uv, args: ['venv', '--python', python, '--seed', dir] }
    ]
    if (requirements)
      steps.push({
        label: 'Installing packages',
        command: uv,
        args: ['pip', 'install', '--python', envPython, '-r', requirements]
      })
    return steps
  }
  const steps: Step[] = [{ label: 'Creating the environment', command: python, args: ['-m', 'venv', dir] }]
  if (requirements)
    steps.push({
      label: 'Installing packages',
      command: envPython,
      args: ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', requirements]
    })
  return steps
}

/** Turns "Requirement already satisfied…"-style pip noise into the last few lines worth showing. */
export function errorTail(output: string, lines = 12): string {
  return output
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .slice(-lines)
    .join('\n')
}
