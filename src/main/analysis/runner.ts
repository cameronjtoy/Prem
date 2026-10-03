import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import type { CellInput, CellOutput } from '@shared/analysis/results'

export interface RunnerReply {
  ok: boolean
  outputs: CellOutput[]
  inputs: CellInput[]
  duration: number
}

interface Pending {
  resolve(reply: RunnerReply): void
  reject(err: Error): void
  timer: NodeJS.Timeout
}

const START_TIMEOUT_MS = 30_000
const STOP_GRACE_MS = 2_000

/**
 * One Python process running prem_runner.py for one note. Cells run one at a time, in order, and share
 * variables. A cell that runs too long is stopped and the process restarted, losing its variables.
 */
export class PythonRunner {
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<string> | null = null
  private pending = new Map<string, Pending>()
  private queue: Promise<unknown> = Promise.resolve()
  private nextId = 1
  private stderr = ''

  constructor(
    private readonly python: string,
    private readonly script: string,
    private readonly env: NodeJS.ProcessEnv = {}
  ) {}

  /** Starts the process if needed; resolves with the Python version. */
  start(): Promise<string> {
    if (this.ready) return this.ready
    const child = spawn(this.python, ['-u', this.script], {
      windowsHide: true,
      env: { ...process.env, MPLBACKEND: 'Agg', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...this.env }
    })
    this.child = child
    this.stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (this.stderr = (this.stderr + chunk.toString()).slice(-4000)))
    const lines = createInterface({ input: child.stdout })
    this.ready = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Python took too long to start')), START_TIMEOUT_MS)
      lines.once('line', (line) => {
        clearTimeout(timer)
        try {
          const hello = JSON.parse(line) as { ready?: boolean; python?: string }
          if (hello.ready) resolve(hello.python ?? '')
          else reject(new Error(`Unexpected reply from Python: ${line}`))
        } catch {
          reject(new Error(`Unexpected reply from Python: ${line}`))
        }
        lines.on('line', (next) => this.receive(next))
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })
    child.stdin.on('error', () => {}) // a write after the process died; its exit handler reports why
    child.on('exit', (code, signal) => {
      if (this.child !== child) return
      const why = this.stderr.trim().split('\n').slice(-5).join('\n')
      this.detach(new Error(why || `Python stopped (${signal ?? `code ${code}`})`))
    })
    this.ready.catch(() => this.kill())
    return this.ready
  }

  /** Runs one cell after any before it. Rejects if Python can't start, or if the cell runs past `timeoutMs`. */
  run(code: string, cwd: string, root: string, timeoutMs: number): Promise<RunnerReply> {
    const result = this.queue.then(() => this.send(code, cwd, root, timeoutMs))
    this.queue = result.catch(() => {})
    return result
  }

  private async send(code: string, cwd: string, root: string, timeoutMs: number): Promise<RunnerReply> {
    await this.start()
    const id = String(this.nextId++)
    return new Promise<RunnerReply>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.kill()
        reject(new Error(`Stopped after ${Math.round(timeoutMs / 1000)} s. Variables from earlier cells were lost.`))
      }, timeoutMs)
      this.pending.set(id, { resolve, reject, timer })
      this.child!.stdin.write(`${JSON.stringify({ id, code, cwd, root })}\n`)
    })
  }

  private receive(line: string): void {
    let reply: RunnerReply & { id?: string }
    try {
      reply = JSON.parse(line)
    } catch {
      return
    }
    const pending = reply.id ? this.pending.get(reply.id) : undefined
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(reply.id!)
    pending.resolve({ ok: reply.ok, outputs: reply.outputs, inputs: reply.inputs, duration: reply.duration })
  }

  get busy(): boolean {
    return this.pending.size > 0
  }

  /** Interrupts the running cell (KeyboardInterrupt), keeping variables; ends the process if that doesn't work. */
  interrupt(): void {
    const child = this.child
    if (!child || !this.busy) return
    if (process.platform === 'win32') return this.kill()
    child.kill('SIGINT')
    setTimeout(() => {
      if (this.child === child && this.busy) this.kill()
    }, STOP_GRACE_MS)
  }

  /** Ends the process now. Cells still waiting fail; the next cell starts a fresh process. */
  kill(): void {
    const child = this.child
    if (!child) return
    this.detach(new Error('Python was restarted'))
    child.kill('SIGKILL')
  }

  private detach(reason: Error): void {
    this.child = null
    this.ready = null
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.reject(reason)
    }
    this.pending.clear()
  }

  get running(): boolean {
    return !!this.child
  }
}
