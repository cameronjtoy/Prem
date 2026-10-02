import { describe, expect, it } from 'vitest'
import type { HistoryEntry } from '@shared/records/history'
import { EMPTY_STATUS, recordStatus, type RecordCheck } from '@shared/records/signatures'
import { formatTime, printableHtml, type PrintableNote, type PrintOptions } from './printable'

const options: PrintOptions = {
  vaultName: 'Lab',
  exportedBy: 'pi',
  exportedAt: new Date('2026-10-01T12:00:00Z'),
  appVersion: '0.1.0',
  embedImage: (path) => (path === 'Notebook/attachments/gel.png' ? 'data:image/png;base64,AAAA' : null)
}

let n = 0
function entry(kind: HistoryEntry['kind'], author: string, extra: Partial<HistoryEntry> = {}): HistoryEntry {
  n++
  return { n, time: `2026-09-30T1${n}:00:00Z`, author, kind, hash: 'h1', size: 10, prev: '', id: `id${n}`, ...extra }
}

function note(content: string, history: HistoryEntry[] = [], check: Partial<RecordCheck> = {}): PrintableNote {
  return {
    path: 'Notebook/Ligation.md',
    content,
    hash: 'h1',
    history,
    status: { ...recordStatus(history), chainOk: true, ...check }
  }
}

describe('printableHtml', () => {
  it('shows frontmatter as a metadata table instead of raw text', () => {
    const html = printableHtml(
      [note('---\ntype: experiment\nauthor: alice\nsamples: "[[S-0001]]"\n---\n# Ligation\n')],
      options
    )
    expect(html).toContain('<th>type</th><td>experiment</td>')
    expect(html).toContain('<th>samples</th><td>S-0001</td>')
    expect(html).not.toContain('---')
  })

  it('prints on A4 unless US Letter is chosen', () => {
    expect(printableHtml([note('Text')], options)).toContain('@page { size: A4; }')
    expect(printableHtml([note('Text')], { ...options, pageSize: 'Letter' })).toContain('@page { size: letter; }')
  })

  it('uses the first heading as the title, or the file name when there is none', () => {
    expect(printableHtml([note('# Ligation of insert\nText')], options).match(/<h1/g)).toHaveLength(1)
    expect(printableHtml([note('Just text')], options)).toContain('<h1>Ligation</h1>')
  })

  it('renders wikilinks as their label', () => {
    const html = printableHtml([note('See [[Plasmid miniprep|the miniprep]] and [[S-0001]].')], options)
    expect(html).toContain('<span class="wikilink">the miniprep</span>')
    expect(html).toContain('<span class="wikilink">S-0001</span>')
  })

  it('embeds images from the vault and marks ones it can’t embed', () => {
    const html = printableHtml([note('![gel](attachments/gel.png)\n\n![lost](attachments/lost.png)')], options)
    expect(html).toContain('src="data:image/png;base64,AAAA"')
    expect(html).toContain('[image: lost]')
  })

  it('prints embedded notebooks and tables as references to the attachment', () => {
    const html = printableHtml([note('![growth.ipynb](attachments/growth.ipynb)')], options)
    expect(html).toContain('<span class="attachment">growth.ipynb</span>')
    expect(html).toContain('(attached: Notebook/attachments/growth.ipynb)')
    expect(html).not.toContain('[image:')
  })

  it('never loads anything from the network', () => {
    const html = printableHtml([note('![remote](https://example.com/x.png)')], options)
    expect(html).not.toContain('src="https://example.com')
    expect(html).toContain("default-src 'none'")
  })

  it('prints raw HTML in a note as text', () => {
    const html = printableHtml([note('<script>alert(1)</script>\n\nA <img src=x onerror=alert(1)> tag')], options)
    expect(html).not.toMatch(/<script>alert/)
    expect(html).not.toMatch(/<img src=x/)
    expect(html).toContain('&lt;script&gt;')
  })

  it('prints task-list checkboxes as characters', () => {
    const html = printableHtml([note('- [x] Pellet cells ✓ 14:12\n- [ ] Lyse')], options)
    expect(html).toContain('<span class="box">☑</span>')
    expect(html).toContain('<span class="box">☐</span>')
    expect(html).not.toContain('<input')
  })

  it('renders equations as MathML', () => {
    const html = printableHtml([note('Inline $c = n/V$ and\n\n$$\nE = mc^2\n$$\n')], options)
    expect(html.match(/<math/g)?.length).toBe(2)
    expect(html).toContain('display="block"')
  })

  it('leaves dollar amounts alone', () => {
    const html = printableHtml([note('Kits cost $40 and $55 each.')], options)
    expect(html).not.toContain('<math')
  })

  it('lists signatures, witnesses and amendments with their reasons', () => {
    const history = [
      entry('save', 'alice'),
      entry('signed', 'alice', { reason: 'Results reviewed' }),
      entry('witnessed', 'pi'),
      entry('amended', 'alice', { reason: 'Lane 4 mislabelled' }),
      entry('save', 'alice', { hash: 'h2' }),
      entry('signed', 'alice', { hash: 'h2' })
    ]
    const html = printableHtml([{ ...note('Body', history), hash: 'h2' }], options)
    expect(html).toContain('<strong>Signed</strong>')
    expect(html).toContain('exactly the content that was signed')
    expect(html).toContain('<td>Witnessed</td><td>pi</td>')
    expect(html).toContain('Reason: Lane 4 mislabelled')
    expect(html).toContain('“Results reviewed”')
    expect(html).toContain('History verified: all 6 entries are intact.')
  })

  it('warns when the history chain is broken or the file changed after signing', () => {
    const history = [entry('save', 'alice'), entry('signed', 'alice')]
    const html = printableHtml([note('Body', history, { chainOk: false, changedOutside: true })], options)
    expect(html).toContain('The history log has been altered')
    expect(html).toContain('changed outside Prem after it was signed')
    expect(html).not.toContain('History verified')
  })

  it('warns when the printed content is not what was signed', () => {
    const history = [entry('save', 'alice'), entry('signed', 'alice')]
    const html = printableHtml([{ ...note('Body', history), hash: 'different' }], options)
    expect(html).toContain('differs from the content that was signed')
  })

  it('says when a note has no history', () => {
    const html = printableHtml([{ ...note('Body'), status: { ...EMPTY_STATUS, chainOk: true } }], options)
    expect(html).toContain('<strong>Not signed</strong>')
    expect(html).toContain('No history has been recorded')
  })

  it('puts each note of a multi-note export on its own page, with a cover line', () => {
    const html = printableHtml([note('# One'), { ...note('# Two'), path: 'Notebook/Two.md' }], options)
    expect(html.match(/<article class="note">/g)).toHaveLength(2)
    expect(html).toContain('.note + .note { break-before: page; }')
    expect(html).toContain('by pi on')
    expect(html).toContain('2 entries')
  })
})

describe('formatTime', () => {
  it('includes the UTC offset so a printed time is unambiguous', () => {
    expect(formatTime('2026-09-30T14:10:00Z')).toMatch(/^2026-09-30 \d\d:\d\d UTC[+-]\d\d:\d\d$/)
  })
})
