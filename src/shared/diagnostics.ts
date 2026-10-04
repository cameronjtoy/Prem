// What goes into a problem report. Nothing is sent by Prem: the report is shown in full, and opening the
// GitHub issue is the person's own choice in their browser. So the text leaves out what doesn't need to be
// shared: where the vault is, the person's home folder, and any access token that found its way into a log.

export const ISSUE_URL = 'https://github.com/cameronjtoy/Prem/issues/new'
/** Browsers and GitHub refuse very long URLs, so the issue body is cut to this many characters. */
const MAX_BODY = 6000

export interface ReportInfo {
  version: string
  /** e.g. "macOS 15.2 (arm64)". */
  os: string
  electron: string
  /** "local", "team server" or "none". */
  vault: string
  /** The last lines of the log, oldest first. */
  log: string[]
}

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Removes the vault's location, the home folder and access tokens from text. Paths are matched with either
 * slash, since Windows paths show up both ways in logs.
 */
export function redact(text: string, where: { vault?: string | null; home?: string | null }): string {
  let out = text
  const replacePath = (p: string | null | undefined, label: string): void => {
    if (!p || p.length < 3) return
    const variants = new Set([p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')])
    for (const v of variants) out = out.replace(new RegExp(escapeRegExp(v), 'gi'), label)
  }
  // The vault first: it's usually inside the home folder.
  replacePath(where.vault, '<vault>')
  replacePath(where.home, '~')
  return out
    .replace(/\bprem_[A-Za-z0-9_-]{16,}/g, 'prem_<token>')
    .replace(/(authorization:\s*bearer\s+)\S+/gi, '$1<token>')
}

/** The report as it's shown and as it goes into the issue. */
export function formatReport(info: ReportInfo): string {
  return [
    '**What happened**',
    '',
    '<!-- What were you doing, and what went wrong? -->',
    '',
    '**About this computer**',
    '',
    `- Prem ${info.version}`,
    `- ${info.os}`,
    `- Electron ${info.electron}`,
    `- Vault: ${info.vault}`,
    '',
    '**Recent log**',
    '',
    '```',
    ...(info.log.length ? info.log : ['(nothing logged)']),
    '```',
    ''
  ].join('\n')
}

/** A link that opens a new GitHub issue with the report filled in, cut short if it's too long for a URL. */
export function issueUrl(report: string, title = 'Problem: '): string {
  let body = report
  if (body.length > MAX_BODY) {
    // Keep the start (what happened, the computer) and the end of the log, which is usually the error.
    const head = body.slice(0, 1500)
    const tail = body.slice(body.length - (MAX_BODY - 1600))
    body = `${head}\n…(log shortened)…\n${tail}`
  }
  const params = new URLSearchParams({ title, body })
  return `${ISSUE_URL}?${params.toString()}`
}
