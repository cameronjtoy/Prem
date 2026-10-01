import { VaultError } from './errors'
import type { VaultPath } from './types'

export const TEMPLATES_FOLDER = 'templates'

export function normalizeVaultPath(input: string): VaultPath {
  if (input.includes('\0')) throw new VaultError('INVALID_PATH', 'Path contains a NUL byte')
  if (/^([a-zA-Z]:|[\\/])/.test(input)) {
    throw new VaultError('INVALID_PATH', `Path must be relative to the vault: ${input}`)
  }
  const parts = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p !== '' && p !== '.')
  if (parts.includes('..')) throw new VaultError('INVALID_PATH', `Path may not contain "..": ${input}`)
  return parts.join('/')
}

export function basename(path: VaultPath): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function dirname(path: VaultPath): VaultPath {
  const i = path.lastIndexOf('/')
  return i < 0 ? '' : path.slice(0, i)
}

export function joinPath(dir: VaultPath, name: string): VaultPath {
  return dir ? `${dir}/${name}` : name
}

export function isMarkdown(path: string): boolean {
  return path.toLowerCase().endsWith('.md')
}

export function stripMd(name: string): string {
  return isMarkdown(name) ? name.slice(0, -3) : name
}

export function noteTitle(path: VaultPath): string {
  return stripMd(basename(path))
}

export function isInside(path: VaultPath, folder: VaultPath): boolean {
  return folder === '' || path === folder || path.startsWith(folder + '/')
}

export function isTemplate(path: VaultPath): boolean {
  return isInside(path, TEMPLATES_FOLDER) && path !== TEMPLATES_FOLDER
}

/** Makes a string safe to use as a file name on macOS, Windows and Linux. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|#^[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
  return cleaned || 'Untitled'
}
