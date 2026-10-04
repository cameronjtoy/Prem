import { describe, expect, it } from 'vitest'
import { formatReport, issueUrl, redact } from './diagnostics'

describe('redact', () => {
  it('removes the vault location, the home folder and tokens', () => {
    const text = [
      '[ipc] vault:read failed Error: ENOENT /Users/sam/Lab vault/Notebook/2026/plate.md',
      'settings at /Users/sam/Library/Application Support/Prem/settings.json',
      'token prem_AbCdEf0123456789xyz_-QQ rejected',
      'Authorization: Bearer prem_AbCdEf0123456789xyz'
    ].join('\n')
    const out = redact(text, { vault: '/Users/sam/Lab vault', home: '/Users/sam' })
    expect(out).toContain('ENOENT <vault>/Notebook/2026/plate.md')
    expect(out).toContain('settings at ~/Library/Application Support')
    expect(out).toContain('token prem_<token> rejected')
    expect(out).toContain('Authorization: Bearer <token>')
    expect(out).not.toMatch(/sam|AbCdEf/)
  })

  it('matches Windows paths with either slash, in any case', () => {
    const out = redact('C:\\Users\\Sam\\Lab\\a.md and c:/users/sam/Lab/b.md', { vault: 'C:\\Users\\Sam\\Lab' })
    expect(out).toBe('<vault>\\a.md and <vault>/b.md')
  })

  it('leaves text alone when there is nothing to remove', () => {
    expect(redact('all fine', { vault: null, home: null })).toBe('all fine')
  })
})

describe('the report', () => {
  const info = { version: '0.1.0', os: 'macOS 15.2 (arm64)', electron: '44.0.0', vault: 'local', log: ['a', 'b'] }

  it('says what it contains', () => {
    const report = formatReport(info)
    expect(report).toContain('- Prem 0.1.0')
    expect(report).toContain('- Vault: local')
    expect(report).toContain('```\na\nb\n```')
  })

  it('opens a prefilled GitHub issue, shortening a long log but keeping its end', () => {
    const url = new URL(issueUrl(formatReport(info)))
    expect(url.origin + url.pathname).toBe('https://github.com/cameronjtoy/Prem/issues/new')
    expect(url.searchParams.get('body')).toContain('- Prem 0.1.0')

    const long = formatReport({ ...info, log: [...Array.from({ length: 2000 }, (_, i) => `line ${i}`), 'THE ERROR'] })
    const body = new URL(issueUrl(long)).searchParams.get('body')!
    expect(body.length).toBeLessThan(6200)
    expect(body).toContain('- Prem 0.1.0')
    expect(body).toContain('THE ERROR')
    expect(body).toContain('(log shortened)')
  })
})
