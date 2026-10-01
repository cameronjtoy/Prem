import { createInterface } from 'node:readline/promises'
import { runCli, type CliIO } from './cli'

const interactive = process.stdin.isTTY && process.stdout.isTTY

const io: CliIO = {
  out: (line) => console.log(line),
  ask: interactive
    ? async (question, fallback) => {
        const rl = createInterface({ input: process.stdin, output: process.stdout })
        try {
          const answer = (await rl.question(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim()
          return answer || fallback || ''
        } finally {
          rl.close()
        }
      }
    : null,
  log: {
    info: (message) => console.log(`${new Date().toISOString()} ${message}`),
    error: (message, err) =>
      console.error(`${new Date().toISOString()} ${message}`, ...(err === undefined ? [] : [err]))
  }
}

runCli(process.argv.slice(2), io).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
