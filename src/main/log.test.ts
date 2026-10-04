import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LogFile } from './log'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'prem-log-'))
})
afterEach(() => rm(dir, { recursive: true, force: true }))

describe('LogFile', () => {
  it('writes timestamped lines and reads back the last ones', () => {
    const log = new LogFile(path.join(dir, 'logs'))
    log.write('info', 'Prem started')
    log.write('error', 'Something failed\nat line 2')
    const tail = log.tail(10)
    expect(tail).toHaveLength(3)
    expect(tail[0]).toMatch(/^\d{4}-\d\d-\d\dT\S+ INFO {2}Prem started$/)
    expect(tail[1]).toMatch(/ERROR Something failed$/)
    expect(tail[2]).toBe('    at line 2')
    expect(log.tail(1)).toEqual(['    at line 2'])
  })

  it('rotates at 1 MB and keeps three older files, still reading across the newest two', async () => {
    const log = new LogFile(dir)
    const big = 'x'.repeat(200_000)
    for (let i = 0; i < 30; i++) log.write('warn', `${i} ${big}`)
    const files = (await readdir(dir)).sort()
    expect(files).toEqual(['main.log', 'main.log.1', 'main.log.2', 'main.log.3'])
    const tail = log.tail(8)
    expect(tail).toHaveLength(8)
    expect(tail[tail.length - 1]).toMatch(/WARN {2}29 x+$/)
  })

  it('never throws, even when it cannot write', () => {
    const log = new LogFile('/dev/null/not-a-folder')
    expect(() => log.write('error', 'lost')).not.toThrow()
    expect(log.tail(5)).toEqual([])
  })
})
