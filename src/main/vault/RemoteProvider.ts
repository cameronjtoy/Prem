import { randomUUID } from 'node:crypto'
import { VaultError, type VaultErrorCode } from '@shared/errors'
import type { HistoryEntry } from '@shared/history'
import type { RecordCheck } from '@shared/signatures'
import { isInside } from '@shared/paths'
import { CLIENT_HEADER, Routes, STATUS_BY_CODE, type ServerInfo } from '@shared/remote'
import type {
  EntryKind,
  FileRecord,
  VaultChange,
  VaultEntry,
  VaultPath,
  WriteOptions,
  WriteResult
} from '@shared/types'
import type { VaultProvider } from './VaultProvider'

const REQUEST_TIMEOUT_MS = 30_000
/** Attachments can be large, so allow a slow connection time to move them. */
const TRANSFER_TIMEOUT_MS = 10 * 60_000
/** The server pings every 25s, so a stream that's silent this long has silently dropped. */
const STREAM_IDLE_MS = 60_000
const MAX_RETRY_MS = 30_000

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Checks a server address and returns it without a trailing slash. Tokens only travel over HTTPS, except to this machine. */
export function normalizeServerUrl(input: string): string {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new VaultError('INVALID_ARGUMENT', `Not a valid server address: ${input}`)
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new VaultError('INVALID_ARGUMENT', 'The server address should not include a user name, query or fragment')
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && LOOPBACK.has(url.hostname))
  if (!secure) throw new VaultError('INVALID_ARGUMENT', 'Team servers must use https:// (http:// only works for localhost)')
  return url.toString().replace(/\/+$/, '')
}

function isErrorCode(code: unknown): code is VaultErrorCode {
  return typeof code === 'string' && code in STATUS_BY_CODE
}

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })
}

/** Yields the `data:` payload of each server-sent event in a stream. */
async function* serverSentEvents(body: ReadableStream<Uint8Array>, onActivity: () => void): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    onActivity()
    buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n')
    let end: number
    while ((end = buffer.indexOf('\n\n')) >= 0) {
      const event = buffer.slice(0, end)
      buffer = buffer.slice(end + 2)
      const data = event
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n')
      if (data) yield data
    }
  }
}

/** A vault hosted by a Prem team server. Access rules are enforced by the server; this is only a client. */
export class RemoteProvider implements VaultProvider {
  readonly name: string
  readonly user: string
  readonly access: ServerInfo['access']
  private readonly clientId = randomUUID()
  private readonly streams = new Set<AbortController>()
  /** What this client last knew of the vault, so a reconnect can report what it missed. */
  private known: Map<VaultPath, EntryKind> | null = null
  private versions = new Map<VaultPath, string>()

  private constructor(
    readonly root: string,
    private readonly token: string,
    info: ServerInfo
  ) {
    this.name = info.name
    this.user = info.user
    this.access = info.access
  }

  /** Checks the address and token, and fails with UNAUTHORIZED or UNAVAILABLE before anything is opened. */
  static async connect(url: string, token: string): Promise<RemoteProvider> {
    const root = normalizeServerUrl(url)
    if (!token.trim()) throw new VaultError('INVALID_ARGUMENT', 'An access token is required')
    const probe = new RemoteProvider(root, token.trim(), { name: '', user: '', access: {} })
    const info = await probe.request<ServerInfo>('GET', Routes.info)
    return new RemoteProvider(root, token.trim(), info)
  }

  private headers(json: boolean): Record<string, string> {
    return {
      authorization: `Bearer ${this.token}`,
      [CLIENT_HEADER]: this.clientId,
      ...(json ? { 'content-type': 'application/json' } : {})
    }
  }

  private url(route: string, path?: VaultPath): URL {
    const url = new URL(this.root + route)
    if (path !== undefined) url.searchParams.set('path', path)
    return url
  }

  private async send(method: string, url: URL, init: { headers: Record<string, string>; body?: string | Uint8Array; timeout: number }): Promise<Response> {
    try {
      return await fetch(url, { method, headers: init.headers, body: init.body, signal: AbortSignal.timeout(init.timeout) })
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      throw new VaultError('UNAVAILABLE', `Can't reach the server at ${this.root} (${reason})`)
    }
  }

  private async request<T>(method: string, route: string, options: { path?: VaultPath; body?: unknown } = {}): Promise<T> {
    const res = await this.send(method, this.url(route, options.path), {
      headers: this.headers(options.body !== undefined),
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      timeout: REQUEST_TIMEOUT_MS
    })
    return this.parse<T>(res)
  }

  private async parse<T>(res: Response): Promise<T> {
    const text = await res.text()
    let data: unknown = null
    try {
      data = text ? JSON.parse(text) : null
    } catch {
      if (res.ok) throw new VaultError('UNKNOWN', `The server sent a response Prem doesn't understand`)
    }
    if (!res.ok) {
      const error = (data as { error?: { code?: unknown; message?: unknown } } | null)?.error
      const code = isErrorCode(error?.code) ? error.code : 'UNKNOWN'
      const message = typeof error?.message === 'string' ? error.message : `The server returned ${res.status}`
      throw new VaultError(code, message)
    }
    return data as T
  }

  async list(): Promise<VaultEntry[]> {
    return this.request<VaultEntry[]>('GET', Routes.entries)
  }

  async read(path: VaultPath): Promise<FileRecord> {
    const file = await this.request<FileRecord>('GET', Routes.file, { path })
    this.versions.set(file.path, file.version)
    return file
  }

  async readAllMarkdown(): Promise<FileRecord[]> {
    const files = await this.request<FileRecord[]>('GET', Routes.files)
    for (const f of files) this.versions.set(f.path, f.version)
    return files
  }

  async write(path: VaultPath, content: string, options: WriteOptions = {}): Promise<WriteResult> {
    const result = await this.request<WriteResult>('PUT', Routes.file, { path, body: { content, ...options } })
    this.versions.set(path, result.version)
    return result
  }

  async readBinary(path: VaultPath): Promise<Uint8Array> {
    const res = await this.send('GET', this.url(Routes.blob, path), { headers: this.headers(false), timeout: TRANSFER_TIMEOUT_MS })
    if (!res.ok) return this.parse<never>(res)
    return new Uint8Array(await res.arrayBuffer())
  }

  async writeBinary(path: VaultPath, data: Uint8Array, options: WriteOptions = {}): Promise<WriteResult> {
    const url = this.url(Routes.blob, path)
    if (options.createOnly) url.searchParams.set('createOnly', '1')
    const res = await this.send('PUT', url, {
      headers: { ...this.headers(false), 'content-type': 'application/octet-stream' },
      body: data,
      timeout: TRANSFER_TIMEOUT_MS
    })
    return this.parse<WriteResult>(res)
  }

  async mkdir(path: VaultPath): Promise<void> {
    await this.request('POST', Routes.folder, { path })
  }

  async rename(from: VaultPath, to: VaultPath): Promise<void> {
    await this.request('POST', Routes.rename, { body: { from, to } })
  }

  async remove(path: VaultPath): Promise<void> {
    await this.request('DELETE', Routes.file, { path })
  }

  history(path: VaultPath): Promise<HistoryEntry[]> {
    return this.request<HistoryEntry[]>('GET', Routes.history, { path })
  }

  async readVersion(path: VaultPath, id: string): Promise<string> {
    const url = this.url(Routes.version, path)
    url.searchParams.set('id', id)
    const res = await this.send('GET', url, { headers: this.headers(false), timeout: REQUEST_TIMEOUT_MS })
    return (await this.parse<{ content: string }>(res)).content
  }

  recordStatus(path: VaultPath): Promise<RecordCheck> {
    return this.request<RecordCheck>('GET', Routes.status, { path })
  }

  sign(path: VaultPath, _author: string, statement?: string): Promise<RecordCheck> {
    return this.request<RecordCheck>('POST', Routes.sign, { path, body: { statement: statement ?? '' } })
  }

  witness(path: VaultPath, _author?: string): Promise<RecordCheck> {
    return this.request<RecordCheck>('POST', Routes.witness, { path, body: {} })
  }

  async exists(path: VaultPath): Promise<boolean> {
    return this.request<boolean>('GET', Routes.exists, { path })
  }

  /** Follows the server's change stream, reconnecting with backoff and reporting anything missed while away. */
  watch(listener: (changes: VaultChange[]) => void): () => void {
    const controller = new AbortController()
    this.streams.add(controller)
    void this.follow(listener, controller.signal)
    return () => {
      controller.abort()
      this.streams.delete(controller)
    }
  }

  private async follow(listener: (changes: VaultChange[]) => void, signal: AbortSignal): Promise<void> {
    let retry = 1000
    let first = true
    while (!signal.aborted) {
      const stream = new AbortController()
      const stop = (): void => stream.abort()
      signal.addEventListener('abort', stop, { once: true })
      let idle: NodeJS.Timeout | undefined
      const touch = (): void => {
        clearTimeout(idle)
        idle = setTimeout(stop, STREAM_IDLE_MS)
      }
      try {
        const res = await fetch(this.url(Routes.events), { headers: this.headers(false), signal: stream.signal })
        if (!res.ok || !res.body) throw new Error(`event stream returned ${res.status}`)
        touch()
        await this.resync(listener, first)
        first = false
        retry = 1000
        for await (const data of serverSentEvents(res.body, touch)) {
          const changes = JSON.parse(data) as VaultChange[]
          this.track(changes)
          listener(changes)
        }
      } catch (err) {
        if (!signal.aborted) console.warn(`[remote] change stream interrupted: ${err instanceof Error ? err.message : err}`)
      } finally {
        clearTimeout(idle)
        signal.removeEventListener('abort', stop)
      }
      await wait(retry, signal)
      retry = Math.min(retry * 2, MAX_RETRY_MS)
    }
  }

  private track(changes: VaultChange[]): void {
    for (const c of changes) {
      if (c.type === 'deleted') {
        for (const p of [...this.versions.keys()]) if (isInside(p, c.path)) this.versions.delete(p)
        if (this.known) for (const p of [...this.known.keys()]) if (isInside(p, c.path)) this.known.delete(p)
      } else {
        this.versions.delete(c.path)
        this.known?.set(c.path, c.kind)
      }
    }
  }

  /** On the first connection this just records a baseline. After a reconnect it reports what changed in between. */
  private async resync(listener: (changes: VaultChange[]) => void, baseline: boolean): Promise<void> {
    const entries = await this.list()
    const now = new Map(entries.map((e) => [e.path, e.kind]))
    const known = this.known
    this.known = now
    if (baseline || !known) return

    const previousVersions = new Map(this.versions)
    const files = await this.readAllMarkdown()
    const changes: VaultChange[] = []
    for (const [path, kind] of known) if (!now.has(path)) changes.push({ type: 'deleted', path, kind })
    for (const [path, kind] of now) if (!known.has(path)) changes.push({ type: 'created', path, kind })
    for (const f of files) {
      if (known.has(f.path) && previousVersions.get(f.path) !== f.version) {
        changes.push({ type: 'modified', path: f.path, kind: 'file' })
      }
    }
    if (changes.length) listener(changes)
  }

  async dispose(): Promise<void> {
    for (const controller of this.streams) controller.abort()
    this.streams.clear()
  }
}
