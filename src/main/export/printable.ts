// Turns notes into one self-contained HTML document for printing to PDF.
//
// The document is what a lab keeps as its record of an entry, so alongside the text it carries the
// note's metadata, every signature, witness and amendment, whether the history chain checks out, and
// a hash of the exact content printed. Nothing in it loads from the network: images from the vault
// are embedded, equations are MathML (no fonts needed), and raw HTML in a note is shown as text.
import katex from 'katex'
import { Marked, type Tokens } from 'marked'
import { describeMeta, parseMeta } from '@shared/analysis/cells'
import { attachmentKind, resolveAttachment } from '@shared/attachments/attachments'
import { parseFrontmatter } from '@shared/notes/frontmatter'
import { mathExtensions } from '@shared/notes/markedMath'
import { splitLinkText } from '@shared/notes/wikilinks'
import type { HistoryEntry } from '@shared/records/history'
import type { RecordCheck } from '@shared/records/signatures'
import { noteTitle } from '@shared/vault/paths'
import type { VaultPath } from '@shared/vault/types'

export interface PrintableNote {
  path: VaultPath
  content: string
  /** SHA-256 of `content`, hex. */
  hash: string
  status: RecordCheck
  history: HistoryEntry[]
}

export interface PrintOptions {
  /** Name of the vault, shown on the cover line. */
  vaultName: string
  exportedBy: string
  exportedAt: Date
  appVersion: string
  /** Returns a data: URI for an image in the vault, or null if it can't be read. */
  embedImage(path: VaultPath): string | null
  /** Paper size. A4 unless the person chose US Letter in settings. */
  pageSize?: 'A4' | 'Letter'
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** Local date and time to the minute, with the UTC offset, so a printed time is unambiguous. */
export function formatTime(iso: string | Date): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return String(iso)
  const offset = -d.getTimezoneOffset()
  const sign = offset >= 0 ? '+' : '-'
  const zone = `UTC${sign}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())} ${zone}`
}

function renderMath(tex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(tex, { displayMode, output: 'mathml', throwOnError: false })
  } catch {
    return `<code>${escapeHtml(tex)}</code>`
  }
}

function markdownRenderer(note: PrintableNote, options: PrintOptions): Marked {
  return new Marked({
    gfm: true,
    extensions: [
      ...mathExtensions(renderMath),
      {
        name: 'wikilink',
        level: 'inline',
        start: (src) => src.indexOf('[['),
        tokenizer(src) {
          const m = /^!?\[\[([^\]\n]+)\]\]/.exec(src)
          if (m) return { type: 'wikilink', raw: m[0], text: m[1] }
          return undefined
        },
        renderer(token) {
          const { target, heading, alias } = splitLinkText(token.text as string)
          const label = alias || (heading ? `${target} › ${heading}` : target)
          return `<span class="wikilink">${escapeHtml(label)}</span>`
        }
      }
    ],
    renderer: {
      // A note's HTML is shown, not interpreted: nothing in a record should run or load when printed.
      html: ({ text }: Tokens.HTML | Tokens.Tag) => {
        // The record of a Python cell's run prints as a line saying what produced the output below it.
        const output = /^<!--\s*prem:output\b(.*?)--!?>\s*$/s.exec(text.trim())
        const meta = output ? parseMeta(output[1]) : null
        if (meta) {
          const inputs = meta.inputs.map((i) => `${i.path} (sha256 ${i.sha256}…)`).join(', ')
          return `<p class="cell-meta">Output of the code above${meta.ok ? '' : ' (failed)'} · ${escapeHtml(
            describeMeta({ ...meta, inputs: [] }, formatTime)
          )} · code ${escapeHtml(meta.code)}${inputs ? ` · read ${escapeHtml(inputs)}` : ''}</p>`
        }
        if (/^<!--\s*\/prem:output\s*--!?>\s*$/.test(text.trim())) return ''
        return escapeHtml(text)
      },
      // Disabled checkboxes print faintly; characters print as clearly as the text around them.
      checkbox: ({ checked }: Tokens.Checkbox) => `<span class="box">${checked ? '☑' : '☐'}</span> `,
      image({ href, text }: Tokens.Image) {
        const path = resolveAttachment(note.path, href)
        if (path && attachmentKind(path) !== 'image') {
          // A notebook or table preview in the app prints as a reference to the attached file.
          return `<span class="attachment">${escapeHtml(path.slice(path.lastIndexOf('/') + 1))}</span> <span class="ref">(attached: ${escapeHtml(path)})</span>`
        }
        const data = path ? options.embedImage(path) : null
        if (data) {
          return `<figure><img src="${data}" alt="${escapeHtml(text)}" /><figcaption>${escapeHtml(path ?? '')}</figcaption></figure>`
        }
        return `<span class="missing">[image: ${escapeHtml(text || href)}]</span>`
      },
      link({ href, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens)
        const path = resolveAttachment(note.path, href)
        if (path) return `<span class="attachment">${inner}</span> <span class="ref">(${escapeHtml(path)})</span>`
        if (/^https?:/i.test(href)) return `${inner} <span class="ref">(${escapeHtml(href)})</span>`
        return inner
      }
    }
  })
}

function metadataTable(fields: Record<string, string>): string {
  const rows = Object.entries(fields)
    .filter(([, value]) => value !== '')
    .map(
      ([key, value]) => `<tr><th>${escapeHtml(key)}</th><td>${escapeHtml(value.replace(/\[\[|\]\]/g, ''))}</td></tr>`
    )
  return rows.length ? `<table class="meta">${rows.join('')}</table>` : ''
}

const STATE_LABEL: Record<RecordCheck['state'], string> = {
  draft: 'Not signed',
  signed: 'Signed',
  witnessed: 'Signed and witnessed',
  amended: 'Amended since it was signed; not signed again'
}

/** The record block: status, every signing event, and what the history check found. */
function recordBlock(note: PrintableNote): string {
  const { status, history } = note
  const events = history.filter((e) => e.kind === 'signed' || e.kind === 'witnessed' || e.kind === 'amended')
  const eventRows = events.map((e) => {
    const what = e.kind === 'signed' ? 'Signed' : e.kind === 'witnessed' ? 'Witnessed' : 'Amended'
    const detail = e.reason ? (e.kind === 'amended' ? `Reason: ${e.reason}` : `“${e.reason}”`) : ''
    return `<tr><td>${what}</td><td>${escapeHtml(e.author || 'unknown')}</td><td>${escapeHtml(formatTime(e.time))}</td><td>${escapeHtml(detail)}</td></tr>`
  })
  const saves = history.filter((e) => e.kind === 'save' || e.kind === 'external')
  const first = history[0]
  const last = history[history.length - 1]

  const problems: string[] = []
  if (!status.chainOk)
    problems.push('The history log has been altered: a past entry was changed, removed or reordered.')
  if (status.changedOutside) problems.push('The file was changed outside Prem after it was signed.')
  if (status.signedHash && status.locked && status.signedHash !== note.hash && !status.changedOutside) {
    problems.push('The printed content differs from the content that was signed.')
  }
  const matchesSignature = status.locked && status.signedHash === note.hash

  const lines = [
    `<p class="state ${status.locked ? 'locked' : ''}"><strong>${STATE_LABEL[status.state]}</strong>${
      matchesSignature ? ' · the content printed here is exactly the content that was signed' : ''
    }</p>`,
    eventRows.length
      ? `<table class="events"><tr><th>Event</th><th>By</th><th>When</th><th>Statement or reason</th></tr>${eventRows.join('')}</table>`
      : '',
    problems.length
      ? `<ul class="problems">${problems.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul>`
      : history.length
        ? `<p class="ok">History verified: all ${history.length} entries are intact.</p>`
        : '<p class="muted">No history has been recorded for this note.</p>',
    `<p class="muted">${[
      first
        ? `Created ${escapeHtml(formatTime(first.time))}${first.author ? ` by ${escapeHtml(first.author)}` : ''}`
        : '',
      last ? `last changed ${escapeHtml(formatTime(last.time))}` : '',
      saves.length ? `${saves.length} saved version${saves.length === 1 ? '' : 's'}` : ''
    ]
      .filter(Boolean)
      .join(' · ')}<br />Content SHA-256: <code>${note.hash}</code></p>`
  ]
  return `<section class="record"><h2 class="record-title">Record</h2>${lines.join('')}</section>`
}

function noteSection(note: PrintableNote, options: PrintOptions): string {
  const { fields, end } = parseFrontmatter(note.content)
  const body = markdownRenderer(note, options).parse(note.content.slice(end), { async: false })
  return `<article class="note">
<header><p class="path">${escapeHtml(note.path)}</p>${/^#\s/m.test(note.content.slice(end)) ? '' : `<h1>${escapeHtml(noteTitle(note.path))}</h1>`}</header>
${metadataTable(fields)}
<div class="body">${body}</div>
${recordBlock(note)}
</article>`
}

export function printableHtml(notes: PrintableNote[], options: PrintOptions): string {
  const title = notes.length === 1 ? noteTitle(notes[0].path) : `${notes.length} entries from ${options.vaultName}`
  const cover = `<p class="exported">Exported from Prem ${escapeHtml(options.appVersion)} by ${escapeHtml(
    options.exportedBy || 'unknown'
  )} on ${escapeHtml(formatTime(options.exportedAt))} · vault “${escapeHtml(options.vaultName)}”${
    notes.length > 1 ? ` · ${notes.length} entries` : ''
  }</p>`
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />
<title>${escapeHtml(title)}</title>
<style>@page { size: ${options.pageSize === 'Letter' ? 'letter' : 'A4'}; }${PRINT_CSS}</style>
</head>
<body>
${cover}
${notes.map((n) => noteSection(n, options)).join('\n')}
</body>
</html>`
}

const PRINT_CSS = `
@page { margin: 18mm 16mm 20mm; }
.cell-meta { font-size: 8pt; color: #666; margin: 2px 0 4px; }
body { font: 10.5pt/1.5 -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; color: #1a1a1a; margin: 0; }
.exported { font-size: 8.5pt; color: #666; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin: 0 0 14px; }
.note + .note { break-before: page; }
.path { font-size: 8.5pt; color: #666; margin: 0; }
h1 { font-size: 18pt; margin: 4px 0 10px; }
h2 { font-size: 13.5pt; margin: 18px 0 6px; }
h3 { font-size: 11.5pt; margin: 14px 0 4px; }
h1, h2, h3 { break-after: avoid; }
table { border-collapse: collapse; margin: 8px 0; font-size: 9.5pt; break-inside: avoid; }
th, td { border: 1px solid #ccc; padding: 3px 7px; text-align: left; vertical-align: top; }
th { background: #f3f3f6; }
table.meta { margin-bottom: 14px; }
table.meta th { width: 9em; font-weight: 600; }
code, pre { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 9pt; }
code { background: #f3f3f6; padding: 0 3px; border-radius: 3px; }
pre { background: #f3f3f6; padding: 8px 10px; border-radius: 4px; white-space: pre-wrap; break-inside: avoid; }
pre code { background: none; padding: 0; }
blockquote { margin: 8px 0; padding-left: 10px; border-left: 3px solid #ccc; color: #444; }
figure { margin: 10px 0; break-inside: avoid; }
figure img { max-width: 100%; max-height: 120mm; }
figcaption, .ref { font-size: 8.5pt; color: #666; }
.wikilink { color: #3b38b8; }
.attachment { text-decoration: underline; }
.missing { color: #a33; font-style: italic; }
li:has(> .box), li:has(> p > .box) { list-style: none; }
.box { display: inline-block; width: 1.2em; margin-left: -1.2em; font-size: 1.1em; line-height: 1; }
.math { margin: 8px 0; overflow-x: auto; }
math { font-size: 1.05em; }
.record { margin-top: 20px; border: 1px solid #bbb; border-radius: 6px; padding: 8px 12px; break-inside: avoid; background: #fafafc; }
.record-title { font-size: 11pt; margin: 0 0 4px; }
.record p { margin: 4px 0; }
.record table { width: 100%; }
.state.locked strong { color: #1b6e3a; }
.ok { color: #1b6e3a; }
.problems { color: #a01818; font-weight: 600; margin: 4px 0; padding-left: 18px; }
.muted { color: #666; font-size: 8.5pt; }
.muted code { font-size: 8pt; word-break: break-all; }
`
