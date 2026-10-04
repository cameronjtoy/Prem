import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { PREM_FOLDER } from '@shared/records/history'
import { VaultError } from '@shared/vault/errors'

/**
 * The layout of a vault's `.prem` folder (history logs and stored versions). Recorded in `.prem/format.json`
 * so a later Prem can upgrade old vaults, and an older Prem won't write to a vault it doesn't understand.
 */
export const VAULT_FORMAT = 1

/** Records the format on first open, and refuses a vault written by a newer Prem. */
export async function checkVaultFormat(root: string): Promise<void> {
  const file = path.join(root, PREM_FOLDER, 'format.json')
  let version: unknown
  try {
    version = (JSON.parse(await readFile(file, 'utf8')) as { version?: unknown }).version
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw new VaultError(
        'UNAVAILABLE',
        `${PREM_FOLDER}/format.json in this vault can't be read. Restore it from a backup.`
      )
    }
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, `${JSON.stringify({ version: VAULT_FORMAT }, null, 2)}\n`, { flag: 'wx' }).catch(() => {})
    return
  }
  if (typeof version !== 'number' || version > VAULT_FORMAT) {
    throw new VaultError(
      'UNAVAILABLE',
      'This vault was last used by a newer version of Prem. Update Prem to open it, so nothing in it is changed by a version that doesn’t understand it.'
    )
  }
}
