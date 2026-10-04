// Setting up a lab on the team server: people, roles and the permissions each role gets.
//
// These functions edit the config as plain JSON, so fields they don't know about (and the order of the
// rest) survive. They never see or store a token: callers generate one and pass in its hash.
import type { AccessLevel } from '@shared/vault/access'
import { notebookFolder } from '@shared/notes/notebook'

export type Role = 'pi' | 'member' | 'viewer'

export const ROLES: Record<Role, string> = {
  pi: 'Runs the lab: edits protocols, samples and templates, reads every notebook, writes their own',
  member: 'Writes their own notebook and samples, reads protocols and the rest of the lab',
  viewer: 'Reads everything they can see, changes nothing (a collaborator or auditor)'
}

export function isRole(value: unknown): value is Role {
  return value === 'pi' || value === 'member' || value === 'viewer'
}

export interface LabOptions {
  /** Whether members can read each other's notebooks. The PI can always read them. */
  shareNotebooks: boolean
}

/** Folders a lab vault starts with. Each person also gets their own notebook folder. */
export const LAB_FOLDERS = ['Protocols', 'Samples', 'Notebooks']

/** The permissions a role gets. The deepest matching folder wins, so a person's own notebook overrides "Notebooks". */
export function roleAccess(role: Role, name: string, options: LabOptions): Record<string, AccessLevel> {
  const own = notebookFolder(name)
  switch (role) {
    case 'pi':
      return { '': 'write', Notebooks: 'read', [own]: 'write' }
    case 'member':
      return {
        '': 'read',
        Notebooks: options.shareNotebooks ? 'read' : 'none',
        [own]: 'write',
        Samples: 'write',
        Jobs: 'write'
      }
    case 'viewer':
      return { '': 'read', Notebooks: options.shareNotebooks ? 'read' : 'none' }
  }
}

/** People's names become folder names and appear in signatures, so keep them plain. */
export function checkName(name: string): string {
  const trimmed = name.trim()
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'-]{0,63}$/u.test(trimmed)) {
    throw new Error(
      `"${name}" can't be used as a name. Use letters, numbers, spaces, dots, hyphens or apostrophes, up to 64 characters.`
    )
  }
  return trimmed
}

interface RawUser {
  name: string
  tokenHash: string
  access: Record<string, AccessLevel>
  role?: Role
  [key: string]: unknown
}

export interface RawConfig {
  vault: string
  host?: string
  port?: number
  users: RawUser[]
  lab?: LabOptions
  [key: string]: unknown
}

export function newLabConfig(settings: {
  vault: string
  host: string
  port: number
  shareNotebooks: boolean
}): RawConfig {
  return {
    vault: settings.vault,
    host: settings.host,
    port: settings.port,
    lab: { shareNotebooks: settings.shareNotebooks },
    users: []
  }
}

function findUser(config: RawConfig, name: string): number {
  const key = name.toLowerCase()
  return config.users.findIndex((u) => u.name.toLowerCase() === key)
}

export function addPerson(config: RawConfig, name: string, role: Role, tokenHash: string): RawConfig {
  const clean = checkName(name)
  if (findUser(config, clean) >= 0)
    throw new Error(`${clean} is already on the server. To issue a new token, use "token ${clean}".`)
  const options = config.lab ?? { shareNotebooks: true }
  const user: RawUser = { name: clean, role, tokenHash, access: roleAccess(role, clean, options) }
  return { ...config, users: [...config.users, user] }
}

export function removePerson(config: RawConfig, name: string): RawConfig {
  const i = findUser(config, name)
  if (i < 0) throw new Error(`There's nobody called ${name} on the server.`)
  if (config.users.length === 1)
    throw new Error(`${config.users[i].name} is the only person on the server, so they can't be removed.`)
  return { ...config, users: config.users.filter((_, j) => j !== i) }
}

/** Replaces someone's token, e.g. when it was lost or may have leaked. The old one stops working. */
export function replaceToken(config: RawConfig, name: string, tokenHash: string): RawConfig {
  const i = findUser(config, name)
  if (i < 0) throw new Error(`There's nobody called ${name} on the server. Add them with "add ${name}".`)
  return { ...config, users: config.users.map((u, j) => (j === i ? { ...u, tokenHash } : u)) }
}

/** One line per person: name, role and what they can write. */
export function describePeople(config: RawConfig): string[] {
  return config.users.map((u) => {
    const writes = Object.entries(u.access)
      .filter(([, level]) => level === 'write')
      .map(([folder]) => folder || 'everything')
    const role = u.role ? ` (${u.role})` : ''
    return `${u.name}${role}: writes ${writes.length ? writes.join(', ') : 'nothing'}`
  })
}
