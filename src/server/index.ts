import { parseArgs } from 'node:util'
import { generateToken, hashToken, loadConfig } from './config'
import { startServer } from './server'

const USAGE = `Usage:
  prem-server [--config prem-server.json]   Host the vault named in the config file
  prem-server token <user name>              Create an access token and print its config entry`

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { config: { type: 'string', short: 'c', default: 'prem-server.json' }, help: { type: 'boolean', short: 'h' } }
  })
  if (values.help) return console.log(USAGE)

  if (positionals[0] === 'token') {
    const name = positionals[1]
    if (!name) throw new Error(`A user name is required.\n\n${USAGE}`)
    const token = generateToken()
    console.log(`Token for ${name} (give this to them; it isn't stored anywhere):\n\n  ${token}\n`)
    console.log('Add this to "users" in your server config, and adjust its access:\n')
    console.log(JSON.stringify({ name, tokenHash: hashToken(token), access: { '': 'read' } }, null, 2))
    return
  }
  if (positionals.length) throw new Error(`Unknown command "${positionals[0]}".\n\n${USAGE}`)

  const config = await loadConfig(values.config)
  const server = await startServer(config)
  console.log(`Prem server hosting ${config.vault} at ${server.url} for ${config.users.length} user(s)`)
  const stop = (): void => void server.close().then(() => process.exit(0))
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
