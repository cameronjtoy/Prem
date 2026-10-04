import { createWriteStream } from 'node:fs'
import { readdir, readFile, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { VaultError } from '@shared/vault/errors'

// A backup of a local vault: one .zip with every note, attachment and Prem's history (.prem), so a backup
// can be restored with the history and signatures still checking out. Written as a standard zip that any
// system can open. Kept within the classic zip limits (4 GB, 65,535 files); a bigger vault is better backed up
// by copying the folder, and the error says so.

const LIMIT = 0xffffffff
const MAX_FILES = 0xffff
/** Files that are the operating system's, not the vault's. */
const SKIP = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini'])

interface Entry {
  name: Buffer
  crc: number
  compressed: number
  size: number
  offset: number
  time: number
  date: number
  method: number
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

async function* walk(root: string, rel = ''): AsyncGenerator<string> {
  const entries = await readdir(path.join(root, rel), { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    if (SKIP.has(e.name)) continue
    const child = rel ? `${rel}/${e.name}` : e.name
    // Symlinks are left out: a backup holds what's in the vault, not what a link points to.
    if (e.isDirectory()) yield* walk(root, child)
    else if (e.isFile()) yield child
  }
}

const tooBig = (): VaultError =>
  new VaultError(
    'INVALID_ARGUMENT',
    'This vault is too big for a single zip backup (over 4 GB or 65,535 files). Copy the vault folder instead.'
  )

/** Writes a zip of everything in `root` to `file`. Returns how many files went in and the zip's size. */
export async function backupVault(
  root: string,
  file: string,
  onProgress?: (done: number) => void
): Promise<{ files: number; bytes: number }> {
  const out = createWriteStream(file)
  const failed = new Promise<never>((_, reject) => out.on('error', reject))
  const write = (chunk: Buffer): Promise<void> =>
    Promise.race([
      failed,
      new Promise<void>((resolve) => {
        if (out.write(chunk)) resolve()
        else out.once('drain', () => resolve())
      })
    ])

  const entries: Entry[] = []
  let offset = 0
  try {
    for await (const rel of walk(root)) {
      if (entries.length >= MAX_FILES) throw tooBig()
      const abs = path.join(root, ...rel.split('/'))
      const data = await readFile(abs)
      const deflated = deflateRawSync(data)
      // Already-compressed files (images, zips) don't shrink: store them as they are.
      const method = deflated.length < data.length ? 8 : 0
      const body = method === 8 ? deflated : data
      const { time, date } = dosTime((await stat(abs)).mtime)
      const name = Buffer.from(rel, 'utf8')
      const entry: Entry = {
        name,
        crc: crc32(data),
        compressed: body.length,
        size: data.length,
        offset,
        time,
        date,
        method
      }
      const header = Buffer.alloc(30)
      header.writeUInt32LE(0x04034b50, 0)
      header.writeUInt16LE(20, 4) // version needed
      header.writeUInt16LE(0x0800, 6) // names are UTF-8
      header.writeUInt16LE(method, 8)
      header.writeUInt16LE(time, 10)
      header.writeUInt16LE(date, 12)
      header.writeUInt32LE(entry.crc, 14)
      header.writeUInt32LE(entry.compressed, 18)
      header.writeUInt32LE(entry.size, 22)
      header.writeUInt16LE(name.length, 26)
      header.writeUInt16LE(0, 28)
      offset += header.length + name.length + body.length
      if (offset > LIMIT) throw tooBig()
      await write(header)
      await write(name)
      await write(body)
      entries.push(entry)
      onProgress?.(entries.length)
    }

    const centralStart = offset
    for (const e of entries) {
      const h = Buffer.alloc(46)
      h.writeUInt32LE(0x02014b50, 0)
      h.writeUInt16LE(20, 4) // made by
      h.writeUInt16LE(20, 6) // version needed
      h.writeUInt16LE(0x0800, 8)
      h.writeUInt16LE(e.method, 10)
      h.writeUInt16LE(e.time, 12)
      h.writeUInt16LE(e.date, 14)
      h.writeUInt32LE(e.crc, 16)
      h.writeUInt32LE(e.compressed, 20)
      h.writeUInt32LE(e.size, 24)
      h.writeUInt16LE(e.name.length, 28)
      h.writeUInt32LE(e.offset, 42)
      await write(h)
      await write(e.name)
      offset += h.length + e.name.length
    }
    if (offset > LIMIT) throw tooBig()
    const end = Buffer.alloc(22)
    end.writeUInt32LE(0x06054b50, 0)
    end.writeUInt16LE(entries.length, 8)
    end.writeUInt16LE(entries.length, 10)
    end.writeUInt32LE(offset - centralStart, 12)
    end.writeUInt32LE(centralStart, 16)
    await write(end)
    offset += end.length
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    return { files: entries.length, bytes: offset }
  } catch (err) {
    // Wait for the stream to close before removing the file: if it hadn't finished opening yet, it would
    // otherwise create the file again, empty, after it was removed.
    await new Promise<void>((resolve) => {
      if (out.closed) resolve()
      else out.once('close', () => resolve()).destroy()
    })
    // Don't leave half a backup that looks like a whole one.
    await unlink(file).catch(() => {})
    throw err
  }
}
