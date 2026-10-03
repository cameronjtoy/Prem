import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { approvalText, requirementLines } from '@shared/analysis/trust'

/** How many approved cells are remembered per vault; the oldest are forgotten first. */
const MAX_CODE = 5000

interface VaultTrust {
  /** sha256 of each environment list approved for installing. */
  environments: string[]
  /** The text of the last vault environment list approved, to show what changed next time. */
  lastEnvironment?: string
  /** sha256 of each piece of cell code approved for running. */
  code: string[]
}

export const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex')

/** The hash an approval of an environment list is kept under: its package lines, so comments don't matter. */
export const environmentApprovalHash = (text: string): string => sha256(requirementLines(text).join('\n'))

/** The hash an approval of this cell code is kept under. */
export const codeApprovalHash = (code: string): string => sha256(approvalText(code))

/**
 * What this computer has approved to install and run, per vault, in `<userData>/analysis-trust.json`. It's
 * outside the vault on purpose: nothing in a note or a synced folder can add to it.
 */
export class TrustStore {
  private data: Record<string, VaultTrust> | null = null
  private writing: Promise<void> = Promise.resolve()

  /** The location is a function so the user-data folder can still be changed before the first use. */
  constructor(private readonly location: () => string) {}

  private get file(): string {
    return this.location()
  }

  private async load(): Promise<Record<string, VaultTrust>> {
    if (this.data) return this.data
    try {
      const raw: unknown = JSON.parse(await readFile(this.file, 'utf8'))
      this.data = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, VaultTrust>) : {}
    } catch {
      this.data = {}
    }
    return this.data
  }

  private async vault(id: string): Promise<VaultTrust> {
    const data = await this.load()
    const entry = data[id]
    if (!entry || !Array.isArray(entry.environments) || !Array.isArray(entry.code))
      data[id] = { environments: [], code: [] }
    return data[id]
  }

  async hasEnvironment(vault: string, hash: string): Promise<boolean> {
    return (await this.vault(vault)).environments.includes(hash)
  }

  async hasCode(vault: string, code: string): Promise<boolean> {
    return (await this.vault(vault)).code.includes(codeApprovalHash(code))
  }

  async lastEnvironment(vault: string): Promise<string | null> {
    return (await this.vault(vault)).lastEnvironment ?? null
  }

  /** Records approvals: an environment list by its hash (with its text, if it's the vault's own list), and cell code. */
  async approve(vault: string, approval: { environment?: string; environmentText?: string; code?: string[] }) {
    const entry = await this.vault(vault)
    if (approval.environment && !entry.environments.includes(approval.environment))
      entry.environments.push(approval.environment)
    if (approval.environmentText !== undefined) entry.lastEnvironment = approval.environmentText
    for (const code of approval.code ?? []) {
      const hash = codeApprovalHash(code)
      if (!entry.code.includes(hash)) entry.code.push(hash)
    }
    if (entry.code.length > MAX_CODE) entry.code.splice(0, entry.code.length - MAX_CODE)
    await this.save()
  }

  private save(): Promise<void> {
    // Writes go one at a time, each to a temporary file first, so a crash can't leave the file half-written.
    this.writing = this.writing
      .catch(() => {})
      .then(async () => {
        await mkdir(path.dirname(this.file), { recursive: true })
        const temp = `${this.file}.${process.pid}.tmp`
        await writeFile(temp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 })
        await rename(temp, this.file)
      })
    return this.writing
  }
}
