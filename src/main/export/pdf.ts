import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BrowserWindow } from 'electron'
import { extension, resolveAttachment } from '@shared/attachments/attachments'
import { VaultError } from '@shared/vault/errors'
import { isInside, isMarkdown, isTemplate } from '@shared/vault/paths'
import type { VaultPath } from '@shared/vault/types'
import type { VaultProvider } from '../vault/VaultProvider'
import { escapeHtml, type PrintableNote } from './printable'

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
  avif: 'image/avif'
}

/** Images over this size are left out of a PDF rather than making it enormous. */
const MAX_IMAGE_BYTES = 25 * 1024 * 1024

/** The notes to print for a path: the note itself, or every note inside a folder, in path order. */
export async function notesToPrint(provider: VaultProvider, path: VaultPath): Promise<VaultPath[]> {
  if (isMarkdown(path)) return [path]
  const entries = await provider.list()
  const notes = entries
    .filter((e) => e.kind === 'file' && isMarkdown(e.path) && !isTemplate(e.path) && (!path || isInside(e.path, path)))
    .map((e) => e.path)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!notes.length) throw new VaultError('NOT_FOUND', 'There are no notes in this folder to export')
  return notes
}

export async function loadPrintable(provider: VaultProvider, path: VaultPath): Promise<PrintableNote> {
  const { content } = await provider.read(path)
  const [status, history] = await Promise.all([provider.recordStatus(path), provider.history(path)])
  return { path, content, hash: createHash('sha256').update(content).digest('hex'), status, history }
}

/** Reads every vault image the notes show, as data: URIs, so the printed page needs nothing else. */
export async function loadImages(provider: VaultProvider, notes: PrintableNote[]): Promise<Map<VaultPath, string>> {
  const images = new Map<VaultPath, string>()
  for (const note of notes) {
    for (const [, target] of note.content.matchAll(/!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
      const path = resolveAttachment(note.path, target)
      const mime = path && MIME[extension(path)]
      if (!path || !mime || images.has(path)) continue
      try {
        const data = await provider.readBinary(path)
        if (data.byteLength <= MAX_IMAGE_BYTES)
          images.set(path, `data:${mime};base64,${Buffer.from(data).toString('base64')}`)
      } catch {
        // A missing or unreadable image is printed as a placeholder.
      }
    }
  }
  return images
}

/**
 * Prints an HTML document to a PDF file. The page is loaded from a temporary file in a hidden window with
 * scripts off and no way to navigate, so nothing in a note can run or reach the network while it prints.
 */
export async function printToPdf(html: string, file: string, footerTitle: string): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'prem-print-'))
  const page = join(dir, 'record.html')
  const win = new BrowserWindow({
    show: false,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  try {
    await writeFile(page, html)
    await win.loadFile(page)
    const pdf = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="font: 7.5pt sans-serif; color: #777; width: 100%; padding: 0 16mm; display: flex; justify-content: space-between;"><span>${escapeHtml(
        footerTitle
      )}</span><span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`
    })
    await writeFile(file, pdf)
  } finally {
    win.destroy()
    await rm(dir, { recursive: true, force: true })
  }
}
