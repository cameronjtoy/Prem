import { randomUUID } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { realpath, stat } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { isVaultError, VaultError } from '@shared/errors'
import { MAX_ATTACHMENT_BYTES } from '@shared/attachments'
import { joinPath, normalizeVaultPath, TEMPLATES_FOLDER } from '@shared/paths'
import { CLIENT_HEADER, Routes, STATUS_BY_CODE, type ServerInfo } from '@shared/remote'
import type { VaultChange, VaultPath, WriteOptions } from '@shared/types'
import { DEFAULT_TEMPLATES } from '../main/vault/defaultTemplates'
import { LocalFsProvider } from '../main/vault/LocalFsProvider'
import { UserDirectory, type ServerConfig, type User } from './config'

const MAX_BODY_BYTES = 20 * 1024 * 1024
const HEARTBEAT_MS = 25_000

export interface Logger {
  info(message: string): void
  error(message: string, err?: unknown): void
}

export interface PremServer {
  url: string
  close(): Promise<void>
}

interface EventClient {
  id: string
  user: User
  res: ServerResponse
}

/** Runs writes to the same path one after another, so a version check and the write it guards can't interleave. */
class KeyedLock {
  private tails = new Map<string, Promise<void>>()

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(key) ?? Promise.resolve()
    let release!: () => void
    const done = new Promise<void>((r) => (release = r))
    const tail = prev.then(() => done)
    this.tails.set(key, tail)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (this.tails.get(key) === tail) this.tails.delete(key)
    }
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body ?? null)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(data)
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const declared = Number(req.headers['content-length'])
  if (declared > limit) throw new VaultError('INVALID_ARGUMENT', 'Request body is too large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > limit) throw new VaultError('INVALID_ARGUMENT', 'Request body is too large')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const body = await readBody(req, MAX_BODY_BYTES)
  try {
    const value = JSON.parse(body.toString('utf8')) as unknown
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  } catch {
    // fall through
  }
  throw new VaultError('INVALID_ARGUMENT', 'Request body must be a JSON object')
}

function str(value: unknown, name: string): string {
  if (typeof value !== 'string') throw new VaultError('INVALID_ARGUMENT', `${name} must be a string`)
  return value
}

function queryPath(url: URL): VaultPath {
  return normalizeVaultPath(str(url.searchParams.get('path'), 'path'))
}

function bearerToken(req: IncomingMessage): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')
  return match ? match[1] : null
}

function forbid(user: User, action: string, path: VaultPath): never {
  throw new VaultError('FORBIDDEN', `${user.name} doesn't have permission to ${action} "${path || '/'}"`)
}

/** Hosts one vault folder for a team over HTTP, with per-user tokens and per-folder permissions. */
export async function startServer(config: ServerConfig, log: Logger = console): Promise<PremServer> {
  const root = await realpath(config.vault)
  if (!(await stat(root)).isDirectory()) throw new Error(`Not a folder: ${config.vault}`)

  const provider = new LocalFsProvider(root)
  if (!(await provider.exists(TEMPLATES_FOLDER))) {
    await provider.mkdir(TEMPLATES_FOLDER)
    for (const [name, content] of Object.entries(DEFAULT_TEMPLATES)) {
      await provider.write(joinPath(TEMPLATES_FOLDER, name), content, { createOnly: true })
    }
  }

  const users = new UserDirectory(config.users)
  const clients = new Set<EventClient>()
  const locks = new KeyedLock()

  const broadcast = (changes: VaultChange[], exceptClient?: string): void => {
    for (const client of clients) {
      if (exceptClient && client.id === exceptClient) continue
      const visible = changes.filter((c) => client.user.access.canSee(c.path, c.kind))
      if (visible.length) client.res.write(`data: ${JSON.stringify(visible)}\n\n`)
    }
  }
  const unwatch = provider.watch((changes) => broadcast(changes))
  const heartbeat = setInterval(() => {
    for (const client of clients) client.res.write(': ping\n\n')
  }, HEARTBEAT_MS)

  const openEvents = (req: IncomingMessage, res: ServerResponse, user: User, clientId: string): void => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    res.write(': connected\n\n')
    const client = { id: clientId, user, res }
    clients.add(client)
    req.on('close', () => clients.delete(client))
  }

  const route = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && url.pathname === Routes.health) return sendJson(res, 200, { ok: true })

    const token = bearerToken(req)
    const user = token ? users.authenticate(token) : null
    if (!user) throw new VaultError('UNAUTHORIZED', 'Missing or invalid access token')
    const { access } = user
    const clientId = typeof req.headers[CLIENT_HEADER] === 'string' ? req.headers[CLIENT_HEADER] : ''

    switch (`${req.method} ${url.pathname}`) {
      case `GET ${Routes.info}`: {
        const info: ServerInfo = { name: provider.name, user: user.name, access: user.rules }
        return sendJson(res, 200, info)
      }
      case `GET ${Routes.entries}`: {
        const entries = await provider.list()
        return sendJson(res, 200, entries.filter((e) => access.canSee(e.path, e.kind)))
      }
      case `GET ${Routes.files}`: {
        const files = await provider.readAllMarkdown()
        return sendJson(res, 200, files.filter((f) => access.canRead(f.path)))
      }
      case `GET ${Routes.file}`: {
        const path = queryPath(url)
        if (!access.canRead(path)) forbid(user, 'read', path)
        return sendJson(res, 200, await provider.read(path))
      }
      case `GET ${Routes.history}`: {
        const path = queryPath(url)
        if (!access.canRead(path)) forbid(user, 'read', path)
        return sendJson(res, 200, await provider.history(path))
      }
      case `GET ${Routes.version}`: {
        const path = queryPath(url)
        if (!access.canRead(path)) forbid(user, 'read', path)
        return sendJson(res, 200, { content: await provider.readVersion(path, str(url.searchParams.get('id'), 'id')) })
      }
      case `GET ${Routes.exists}`: {
        const path = queryPath(url)
        if (!access.canSee(path, 'folder')) forbid(user, 'read', path)
        return sendJson(res, 200, await provider.exists(path))
      }
      case `PUT ${Routes.file}`: {
        const path = queryPath(url)
        if (!access.canWrite(path)) forbid(user, 'edit', path)
        const body = await readJson(req)
        const content = str(body.content, 'content')
        const options: WriteOptions = {
          expectedVersion: typeof body.expectedVersion === 'string' ? body.expectedVersion : undefined,
          createOnly: body.createOnly === true,
          // Attribution comes from the token, never from the request body.
          author: user.name
        }
        const result = await locks.run(path.toLowerCase(), async () => {
          const existed = await provider.exists(path)
          try {
            const written = await provider.write(path, content, options)
            // The provider hides its own writes from its watcher, so tell everyone else here.
            if (existed) broadcast([{ type: 'modified', path, kind: 'file' }], clientId)
            return written
          } catch (err) {
            if (isVaultError(err, 'CONFLICT')) throw new VaultError('CONFLICT', `${path} was changed by someone else`)
            throw err
          }
        })
        log.info(`${user.name} saved ${path}`)
        return sendJson(res, 200, result)
      }
      case `GET ${Routes.blob}`: {
        const path = queryPath(url)
        if (!access.canRead(path)) forbid(user, 'read', path)
        const data = await provider.readBinary(path)
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': data.byteLength,
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff'
        })
        return void res.end(data)
      }
      case `PUT ${Routes.blob}`: {
        const path = queryPath(url)
        if (!access.canWrite(path)) forbid(user, 'add files to', path)
        const data = await readBody(req, MAX_ATTACHMENT_BYTES)
        const createOnly = url.searchParams.get('createOnly') === '1'
        const result = await locks.run(path.toLowerCase(), () => provider.writeBinary(path, data, { createOnly }))
        log.info(`${user.name} saved ${path}`)
        return sendJson(res, 200, result)
      }
      case `POST ${Routes.folder}`: {
        const path = queryPath(url)
        if (!access.canWrite(path)) forbid(user, 'create folders in', path)
        await provider.mkdir(path)
        log.info(`${user.name} created folder ${path}`)
        return sendJson(res, 200, null)
      }
      case `POST ${Routes.rename}`: {
        const body = await readJson(req)
        const from = normalizeVaultPath(str(body.from, 'from'))
        const to = normalizeVaultPath(str(body.to, 'to'))
        if (!access.canWriteTree(from)) forbid(user, 'move', from)
        if (!access.canWriteTree(to)) forbid(user, 'move things to', to)
        await provider.rename(from, to, user.name)
        log.info(`${user.name} moved ${from} to ${to}`)
        return sendJson(res, 200, null)
      }
      case `DELETE ${Routes.file}`: {
        const path = queryPath(url)
        if (!access.canWriteTree(path)) forbid(user, 'delete', path)
        await provider.remove(path, user.name)
        log.info(`${user.name} deleted ${path}`)
        return sendJson(res, 200, null)
      }
      case `GET ${Routes.events}`:
        return openEvents(req, res, user, clientId)
      default:
        throw new VaultError('NOT_FOUND', `No such endpoint: ${req.method} ${url.pathname}`)
    }
  }

  const server = createServer((req, res) => {
    route(req, res).catch((err: unknown) => {
      if (res.headersSent) return void res.end()
      if (err instanceof VaultError) {
        return sendJson(res, STATUS_BY_CODE[err.code], { error: { code: err.code, message: err.message } })
      }
      const ref = randomUUID().slice(0, 8)
      log.error(`Request ${req.method} ${req.url} failed (ref ${ref})`, err)
      sendJson(res, 500, { error: { code: 'UNKNOWN', message: `Server error (ref ${ref})` } })
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.host, () => resolve())
  })
  const { address, port } = server.address() as AddressInfo
  const host = address.includes(':') ? `[${address}]` : address

  return {
    url: `http://${host}:${port}`,
    close: async () => {
      unwatch()
      clearInterval(heartbeat)
      for (const client of clients) client.res.end()
      clients.clear()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await provider.dispose()
    }
  }
}
