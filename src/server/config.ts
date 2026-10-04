import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { Access, isAccessLevel, type AccessLevel } from '@shared/vault/access'

export interface UserConfig {
  name: string
  /** `sha256:<hex>` of the user's token. The token itself is never stored. */
  tokenHash: string
  access: Record<string, AccessLevel>
  /** "pi", "member" or "viewer", as `prem-server` sets it. A PI can move anyone's jobs on. */
  role?: string
}

export interface ServerConfig {
  /** Absolute path of the vault folder the server hosts. */
  vault: string
  host: string
  port: number
  users: UserConfig[]
}

export interface User {
  name: string
  access: Access
  rules: Record<string, AccessLevel>
  role?: string
  /** Which token they signed in with, so a reload can tell when it was replaced. */
  tokenHash: string
}

const HASH_PREFIX = 'sha256:'

export function hashToken(token: string): string {
  return HASH_PREFIX + createHash('sha256').update(token, 'utf8').digest('hex')
}

/** A new random token, formatted so it's recognisable if it leaks into a log or a commit. */
export function generateToken(): string {
  return `prem_${randomBytes(32).toString('base64url')}`
}

function fail(message: string): never {
  throw new Error(`Invalid server config: ${message}`)
}

/** Parses a config file. A relative `vault` path is resolved against the config file's folder. */
export function parseConfig(raw: unknown, baseDir: string): ServerConfig {
  if (typeof raw !== 'object' || raw === null) fail('expected a JSON object')
  const { vault, host = '127.0.0.1', port = 4747, users } = raw as Record<string, unknown>
  if (typeof vault !== 'string' || !vault) fail('"vault" must be the path of a folder')
  if (typeof host !== 'string') fail('"host" must be a string')
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 0 || port > 65535)
    fail('"port" is not a valid port')
  if (!Array.isArray(users) || users.length === 0) fail('"users" must list at least one user')

  const names = new Set<string>()
  const parsedUsers = users.map((u: unknown, i): UserConfig => {
    const { name, tokenHash, access, role } = (u ?? {}) as Record<string, unknown>
    if (typeof name !== 'string' || !name) fail(`users[${i}].name is required`)
    if (names.has(name)) fail(`user "${name}" is listed twice`)
    names.add(name)
    if (typeof tokenHash !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(tokenHash)) {
      fail(`users[${i}].tokenHash must look like "sha256:<64 hex characters>"`)
    }
    if (typeof access !== 'object' || access === null) fail(`users[${i}].access must map folders to levels`)
    for (const [folder, level] of Object.entries(access)) {
      if (!isAccessLevel(level)) fail(`users[${i}].access["${folder}"] must be "none", "read" or "write"`)
    }
    if (role !== undefined && typeof role !== 'string') fail(`users[${i}].role must be a string`)
    return { name, tokenHash, access: access as Record<string, AccessLevel>, ...(role ? { role } : {}) }
  })

  return { vault: path.resolve(baseDir, vault), host, port, users: parsedUsers }
}

export async function loadConfig(file: string): Promise<ServerConfig> {
  const raw = JSON.parse(await readFile(file, 'utf8')) as unknown
  return parseConfig(raw, path.dirname(path.resolve(file)))
}

/** Looks users up by token without leaking, through timing, how much of a guess was right. */
export class UserDirectory {
  private readonly users: { hash: Buffer; user: User }[]

  constructor(users: UserConfig[]) {
    this.users = users.map((u) => ({
      hash: Buffer.from(u.tokenHash.slice(HASH_PREFIX.length), 'hex'),
      user: { name: u.name, access: new Access(u.access), rules: u.access, role: u.role, tokenHash: u.tokenHash }
    }))
  }

  /** True if `user` is still on the server with the same token and the same permissions. */
  stillValid(user: User): boolean {
    const current = this.users.find((e) => e.user.name === user.name)?.user
    return (
      !!current &&
      current.tokenHash === user.tokenHash &&
      current.role === user.role &&
      JSON.stringify(current.rules) === JSON.stringify(user.rules)
    )
  }

  authenticate(token: string): User | null {
    const hash = Buffer.from(hashToken(token).slice(HASH_PREFIX.length), 'hex')
    let found: User | null = null
    for (const entry of this.users) if (timingSafeEqual(entry.hash, hash)) found = entry.user
    return found
  }
}
