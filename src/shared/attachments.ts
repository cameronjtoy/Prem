import { VaultError } from './errors'
import { dirname, isMarkdown, joinPath, normalizeVaultPath, sanitizeFileName } from './paths'
import type { VaultPath } from './types'

/** Attachments are stored next to the note that uses them, so they share its folder's permissions. */
export const ATTACHMENTS_FOLDER = 'attachments'

/** Largest attachment accepted, in bytes. Bigger files (raw instrument data) should stay on shared storage. */
export const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024

export type AttachmentKind = 'image' | 'table' | 'file'

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])
const TABLE = new Set(['csv', 'tsv'])

/**
 * File types that are safe to hand to the operating system's default app. Anything else
 * (scripts, installers, unknown formats) is only revealed in its folder, so a file a teammate
 * attached can never run just by being clicked.
 */
const SAFE_TO_OPEN = new Set([
  ...IMAGE,
  ...TABLE,
  'tif', 'tiff', 'pdf', 'txt', 'rtf', 'json', 'xml',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
  'fasta', 'fa', 'fna', 'faa', 'fastq', 'fq', 'gb', 'gbk', 'genbank', 'embl', 'ab1', 'abi', 'snapgene', 'dna',
  'sam', 'vcf', 'bed', 'gff', 'gff3', 'gtf', 'pdb', 'cif', 'mol', 'mol2', 'sdf', 'fcs', 'mzml', 'czi', 'nd2', 'lif'
])

export function extension(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function attachmentKind(path: string): AttachmentKind {
  const ext = extension(path)
  if (IMAGE.has(ext)) return 'image'
  if (TABLE.has(ext)) return 'table'
  return 'file'
}

export function isSafeToOpen(path: string): boolean {
  return SAFE_TO_OPEN.has(extension(path))
}

/** A clean file name for an attachment. Notes can't be attached, since they'd be treated as notes. */
export function attachmentFileName(name: string): string {
  // Keep the extension attached: "gel ?.png" → "gel.png", not "gel .png".
  const cleaned = sanitizeFileName(name).replace(/\s+(\.[^.\s]+)$/, '$1')
  if (isMarkdown(cleaned)) throw new VaultError('INVALID_ARGUMENT', 'Markdown files are notes, not attachments')
  return cleaned
}

/** `name.png` → `name 1.png`, keeping the extension. */
export function numberedName(name: string, n: number): string {
  if (n === 0) return name
  const dot = name.lastIndexOf('.')
  return dot > 0 ? `${name.slice(0, dot)} ${n}${name.slice(dot)}` : `${name} ${n}`
}

/** The folder a note's attachments go in. */
export function attachmentFolder(notePath: VaultPath): VaultPath {
  return joinPath(dirname(notePath), ATTACHMENTS_FOLDER)
}

/** The markdown a note uses to show an attachment: embedded if Prem can preview it, a plain link otherwise. */
export function attachmentMarkdown(notePath: VaultPath, attachmentPath: VaultPath): string {
  const base = dirname(notePath)
  const rel = base && attachmentPath.startsWith(base + '/') ? attachmentPath.slice(base.length + 1) : attachmentPath
  const url = encodeURI(rel).replace(/\(/g, '%28').replace(/\)/g, '%29')
  const name = rel.slice(rel.lastIndexOf('/') + 1).replace(/[[\]]/g, '')
  return attachmentKind(rel) === 'file' ? `[${name}](${url})` : `![${name}](${url})`
}

/**
 * Turns a link written in a note into a vault path, relative to the note's folder.
 * Returns null for web links, links to other notes, and anything that would leave the vault.
 */
export function resolveAttachment(notePath: VaultPath, url: string): VaultPath | null {
  if (!url || /^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('#')) return null
  let decoded: string
  try {
    decoded = decodeURI(url.split('#')[0])
  } catch {
    return null
  }
  const parts = [...dirname(notePath).split('/'), ...decoded.split('/')].filter((p) => p && p !== '.')
  const resolved: string[] = []
  for (const part of parts) {
    if (part === '..') {
      if (!resolved.length) return null
      resolved.pop()
    } else resolved.push(part)
  }
  try {
    const path = normalizeVaultPath(resolved.join('/'))
    return path && !isMarkdown(path) ? path : null
  } catch {
    return null
  }
}
