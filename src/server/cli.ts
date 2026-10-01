import { watch } from 'node:fs'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parseArgs } from 'node:util'
import { notebookFolder } from '@shared/notes/notebook'
import { generateToken, hashToken, loadConfig, parseConfig, type ServerConfig } from './config'
import {
  addPerson,
  checkName,
  describePeople,
  isRole,
  LAB_FOLDERS,
  newLabConfig,
  removePerson,
  replaceToken,
  ROLES,
  type RawConfig,
  type Role
} from './lab'
import { startServer, type Logger, type PremServer } from './server'

export const USAGE = `Usage: prem-server [command] [--config prem-server.json]

  (no command)            Host the lab's vault. Changes to the config file apply without a restart.
  init                    Set up a new lab: the vault folder, the PI and members, and a token for each
  add <name> [--role r]   Add a person and print their token. Roles: member (default), pi, viewer
  remove <name>           Remove a person; their token stops working at once
  token <name>            Give someone a new token; the old one stops working
  list                    Show who is on the server and what they can write

init options, to run it without questions (for scripts and Docker):
  --vault <folder>  --pi <name>  --members <a,b,c>  --host <address>  --port <n>  --private-notebooks`

export interface CliIO {
  out(line: string): void
  /** Asks a question and returns the answer, or the default if the answer is empty. Null when there's no terminal. */
  ask: ((question: string, fallback?: string) => Promise<string>) | null
  log: Logger
}

/** Writes JSON so a crash mid-write can't leave a half-written config, readable only by its owner (it lists token hashes). */
async function writeConfigFile(file: string, config: RawConfig): Promise<void> {
  const tmp = `${file}.${process.pid}.tmp`
  await writeFile(tmp, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 })
  await rename(tmp, file)
}

async function readConfigFile(file: string): Promise<RawConfig> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch {
    throw new Error(`No config at ${file}. Run "prem-server init" to set up a lab, or pass --config.`)
  }
  const raw = JSON.parse(text) as RawConfig
  parseConfig(raw, path.dirname(file)) // validate before changing anything
  return raw
}

function vaultDir(file: string, config: RawConfig): string {
  return path.resolve(path.dirname(file), config.vault)
}

async function makeNotebook(file: string, config: RawConfig, name: string): Promise<void> {
  await mkdir(path.join(vaultDir(file, config), ...notebookFolder(name).split('/')), { recursive: true })
}

function splitNames(list: string | undefined): string[] {
  return (list ?? '')
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean)
}

function printToken(io: CliIO, name: string, token: string): void {
  io.out(`  ${name.padEnd(16)} ${token}`)
}

const JOIN_HELP = [
  '',
  'Give each person their token privately; it is shown only now and is not stored anywhere.',
  'In Prem they enter the server address and their token under "Or join your lab\'s shared vault".',
  'Lost a token? Run "prem-server token <name>" to issue a new one.'
]

async function init(file: string, values: Record<string, string | boolean | undefined>, io: CliIO): Promise<void> {
  const exists = await readFile(file).then(
    () => true,
    () => false
  )
  if (exists) throw new Error(`${file} already exists. Use "add" to add people, or choose another --config.`)

  const flag = (name: string): string | undefined =>
    typeof values[name] === 'string' ? (values[name] as string) : undefined
  const scripted = flag('pi') !== undefined
  const ask = async (question: string, fallback: string, given: string | undefined): Promise<string> => {
    if (given !== undefined) return given
    if (scripted || !io.ask) return fallback
    return io.ask(question, fallback)
  }
  if (!scripted && !io.ask)
    throw new Error('Run init in a terminal, or pass at least --pi <name> to set it up without questions.')

  if (!scripted) io.out('Setting up a Prem lab server. Press Enter to accept the suggestion in brackets.\n')
  const vault = await ask('Folder for the lab notebook', 'vault', flag('vault'))
  const pis = splitNames(await ask('Who runs the lab (the PI)? Names separated by commas', '', flag('pi')))
  if (!pis.length) throw new Error('At least one person must run the lab.')
  const members = splitNames(
    await ask('Lab members, separated by commas (you can add more later)', '', flag('members'))
  )
  const share = values['private-notebooks']
    ? 'n'
    : await ask("Can members read each other's notebooks? (y/n)", 'y', scripted ? 'y' : undefined)
  if (!scripted)
    io.out('\n127.0.0.1 accepts connections from this machine only: use it behind Tailscale or Caddy here.')
  if (!scripted) io.out('0.0.0.0 accepts them from the network, and is needed inside Docker.')
  const host = await ask('Address to listen on', '127.0.0.1', flag('host'))
  const port = Number(await ask('Port', '4747', flag('port')))

  let config = newLabConfig({ vault, host, port, shareNotebooks: !/^n/i.test(share) })
  const tokens: [string, string][] = []
  for (const [names, role] of [
    [pis, 'pi'],
    [members, 'member']
  ] as const) {
    for (const name of names) {
      const token = generateToken()
      config = addPerson(config, checkName(name), role, hashToken(token))
      tokens.push([checkName(name), token])
    }
  }
  parseConfig(config, path.dirname(file))

  const root = vaultDir(file, config)
  for (const folder of LAB_FOLDERS) await mkdir(path.join(root, folder), { recursive: true })
  for (const [name] of tokens) await makeNotebook(file, config, name)
  await writeConfigFile(file, config)

  io.out(`\nCreated ${file} and the vault at ${root}.`)
  io.out(
    `Notebooks are ${config.lab?.shareNotebooks ? 'readable by the whole lab' : 'private to each person and the PI'}.\n`
  )
  io.out('Tokens:')
  for (const [name, token] of tokens) printToken(io, name, token)
  io.out(JOIN_HELP.join('\n'))
  io.out(`\nStart the server with: prem-server --config ${file}`)
}

async function add(file: string, name: string | undefined, role: string, io: CliIO): Promise<void> {
  if (!name) throw new Error(`Say who to add, e.g. "add alice".\n\n${USAGE}`)
  if (!isRole(role)) throw new Error(`Unknown role "${role}". Roles: ${Object.keys(ROLES).join(', ')}.`)
  const config = await readConfigFile(file)
  const token = generateToken()
  const next = addPerson(config, name, role as Role, hashToken(token))
  await makeNotebook(file, next, checkName(name))
  await writeConfigFile(file, next)
  io.out(`Added ${checkName(name)} as ${role}: ${ROLES[role as Role].toLowerCase()}.\n`)
  printToken(io, checkName(name), token)
  io.out(JOIN_HELP.join('\n'))
  io.out('\nA running server picks this up within a second; no restart needed.')
}

async function remove(file: string, name: string | undefined, io: CliIO): Promise<void> {
  if (!name) throw new Error(`Say who to remove, e.g. "remove alice".\n\n${USAGE}`)
  const next = removePerson(await readConfigFile(file), name)
  await writeConfigFile(file, next)
  io.out(`Removed ${name}. Their token no longer works; their notebook stays in the vault.`)
}

async function issueToken(file: string, name: string | undefined, io: CliIO): Promise<void> {
  if (!name) throw new Error(`Say whose token to replace, e.g. "token alice".\n\n${USAGE}`)
  const config = await readConfigFile(file)
  const fresh = generateToken()
  await writeConfigFile(file, replaceToken(config, name, hashToken(fresh)))
  io.out(`New token for ${name}. Their old token no longer works.\n`)
  printToken(io, name, fresh)
}

/** Watches the config file, including editors that save by replacing it, and calls back once per burst of changes. */
export function watchConfig(file: string, onChange: () => void): () => void {
  const name = path.basename(file)
  let timer: NodeJS.Timeout | null = null
  const watcher = watch(path.dirname(path.resolve(file)), (_event, changed) => {
    if (changed !== null && changed !== name) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(onChange, 250)
  })
  return () => {
    if (timer) clearTimeout(timer)
    watcher.close()
  }
}

/** Re-reads the config and applies the people and permissions in it. A broken file is reported and ignored. */
export async function reloadConfig(
  file: string,
  running: ServerConfig,
  server: PremServer,
  log: Logger
): Promise<void> {
  let next: ServerConfig
  try {
    next = await loadConfig(file)
  } catch (err) {
    return log.error(`Kept the previous settings: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (next.vault !== running.vault || next.host !== running.host || next.port !== running.port) {
    log.error('The vault, host or port changed in the config; restart the server to apply them.')
  }
  server.updateUsers(next.users)
  log.info(`Reloaded people and permissions: ${next.users.length} ${next.users.length === 1 ? 'person' : 'people'}`)
}

async function serve(file: string, io: CliIO): Promise<void> {
  const config = await loadConfig(file)
  const server = await startServer(config, io.log)
  io.log.info(`Prem server hosting ${config.vault} at ${server.url} for ${config.users.length} user(s)`)
  const reload = (): void => void reloadConfig(file, config, server, io.log)
  const unwatch = watchConfig(file, reload)
  process.on('SIGHUP', reload)
  const stop = (): void => {
    unwatch()
    void server.close().then(() => process.exit(0))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

export async function runCli(argv: string[], io: CliIO): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string', short: 'c', default: 'prem-server.json' },
      role: { type: 'string', default: 'member' },
      vault: { type: 'string' },
      pi: { type: 'string' },
      members: { type: 'string' },
      host: { type: 'string' },
      port: { type: 'string' },
      'private-notebooks': { type: 'boolean' },
      help: { type: 'boolean', short: 'h' }
    }
  })
  if (values.help) return io.out(USAGE)
  const file = path.resolve(values.config)
  const [command, name, ...extra] = positionals
  if (extra.length) throw new Error(`Too many arguments. Put names with spaces in quotes.\n\n${USAGE}`)

  switch (command) {
    case undefined:
      return serve(file, io)
    case 'init':
      return init(file, values, io)
    case 'add':
      return add(file, name, values.role, io)
    case 'remove':
      return remove(file, name, io)
    case 'token':
      return issueToken(file, name, io)
    case 'list': {
      const config = await readConfigFile(file)
      for (const line of describePeople(config)) io.out(line)
      return
    }
    default:
      throw new Error(`Unknown command "${command}".\n\n${USAGE}`)
  }
}
