// Read-only preview of a Jupyter notebook attachment: the markdown, code and saved outputs, as of the
// last time it was run and saved. Nothing executes. Notebook HTML (such as pandas tables) is sanitized,
// and only images embedded in the file are shown, so a preview can't run scripts or contact the network.
import { LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { classHighlighter, highlightCode } from '@lezer/highlight'
import DOMPurify from 'dompurify'
import katex from 'katex'
import { Marked } from 'marked'
import {
  imageDataUrl,
  parseNotebook,
  type Notebook,
  type NotebookCell,
  type NotebookOutput
} from '@shared/attachments/notebook'
import { mathExtensions } from '@shared/notes/markedMath'
import type { EditorHost } from './host'

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const markdown = new Marked({
  gfm: true,
  extensions: mathExtensions((tex, displayMode) =>
    katex.renderToString(tex, { displayMode, throwOnError: false, trust: false, strict: 'ignore' })
  ),
  // HTML written in a markdown cell is shown as text, like in a Prem note.
  renderer: { html: ({ text }) => escapeHtml(text) }
})

let hooksInstalled = false
/** Only images embedded in the notebook load; links are kept but opened by the app, never in this window. */
function installHooks(): void {
  if (hooksInstalled) return
  hooksInstalled = true
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.hasAttribute('src') && !/^data:image\//i.test(node.getAttribute('src') ?? '')) node.removeAttribute('src')
    node.removeAttribute('srcset')
    node.removeAttribute('background')
    if (node.tagName === 'A') node.setAttribute('rel', 'noreferrer')
  })
}

/** Rendered markdown and KaTeX: no raw HTML gets this far, so inline styles (which KaTeX needs) are allowed. */
function sanitizeMarkdown(html: string): DocumentFragment {
  installHooks()
  return markBlockedImages(DOMPurify.sanitize(html, { RETURN_DOM_FRAGMENT: true }))
}

/** Images whose source was removed (web addresses, files elsewhere) are replaced by a note saying so. */
function markBlockedImages(fragment: DocumentFragment): DocumentFragment {
  for (const img of fragment.querySelectorAll('img:not([src])')) {
    const alt = img.getAttribute('alt')
    img.replaceWith(el('span', 'nb-blocked', `[image not shown${alt ? `: ${alt}` : ''}]`))
  }
  return fragment
}

/** HTML a notebook produced: tables and text formatting only, no styles, forms or embedded documents. */
function sanitizeOutput(html: string): DocumentFragment {
  installHooks()
  const fragment = DOMPurify.sanitize(html, {
    RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'svg', 'math'],
    FORBID_ATTR: ['style', 'class', 'id']
  })
  return markBlockedImages(fragment)
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const parsers = new Map<string, Promise<LanguageDescription | null>>()
function languageFor(name: string): Promise<LanguageDescription | null> {
  const key = name.toLowerCase()
  let found = parsers.get(key)
  if (!found) {
    const description = LanguageDescription.matchLanguageName(languages, key.replace(/\s.*$/, ''), true)
    found = description ? description.load().then(() => description) : Promise.resolve(null)
    parsers.set(key, found)
  }
  return found
}

/** Fills `pre` with syntax-highlighted code once the language is loaded; until then it shows plain text. */
function highlightInto(pre: HTMLElement, code: string, language: string): void {
  void languageFor(language).then((description) => {
    const parser = description?.support?.language.parser
    if (!parser) return
    pre.textContent = ''
    highlightCode(
      code,
      parser.parse(code),
      classHighlighter,
      (text, classes) => pre.append(classes ? el('span', classes, text) : document.createTextNode(text)),
      () => pre.append('\n')
    )
  })
}

function renderOutput(output: NotebookOutput): HTMLElement {
  switch (output.kind) {
    case 'text':
      return el('pre', `nb-output nb-text${output.stream === 'stderr' ? ' nb-stderr' : ''}`, output.text)
    case 'error': {
      const box = el('div', 'nb-output nb-error')
      box.append(el('strong', undefined, `${output.name}: ${output.message}`))
      if (output.traceback) box.append(el('pre', undefined, output.traceback))
      return box
    }
    case 'image': {
      const img = el('img', 'nb-output nb-image')
      img.src = imageDataUrl(output)
      img.alt = 'Notebook output'
      return img
    }
    case 'html': {
      const box = el('div', 'nb-output nb-html')
      box.append(sanitizeOutput(output.html))
      if (!box.textContent?.trim() && output.fallback) box.replaceChildren(el('pre', 'nb-text', output.fallback))
      return box
    }
    case 'unsupported':
      return el(
        'div',
        'nb-output nb-unsupported',
        `Output not shown here (${output.mime}). Open the notebook to see it.`
      )
  }
}

function renderCell(cell: NotebookCell, language: string): HTMLElement {
  const box = el('div', `nb-cell nb-${cell.type}`)
  if (cell.type === 'markdown') {
    box.append(sanitizeMarkdown(markdown.parse(cell.source, { async: false })))
    return box
  }
  if (cell.type === 'raw') {
    box.append(el('pre', 'nb-text', cell.source))
    return box
  }
  const input = el('div', 'nb-input')
  input.append(el('span', 'nb-prompt', cell.executionCount === undefined ? 'In [ ]' : `In [${cell.executionCount}]`))
  const code = el('pre', 'nb-source', cell.source)
  if (cell.source.trim()) highlightInto(code, cell.source, language)
  input.append(code)
  box.append(input)
  for (const output of cell.outputs) box.append(renderOutput(output))
  return box
}

function renderNotebook(wrap: HTMLElement, notebook: Notebook, name: string, onOpen: () => void): void {
  const header = el('div', 'nb-header')
  const codeCells = notebook.cells.filter((c) => c.type === 'code')
  const ran = codeCells.filter((c) => c.executionCount !== undefined).length
  header.append(
    el('span', 'nb-title', `📓 ${name}`),
    el(
      'span',
      'nb-meta',
      `${notebook.language} · ${notebook.cells.length} cells · ${ran} of ${codeCells.length} code cells were run`
    )
  )
  const open = el('button', 'nb-open', 'Open')
  open.title = 'Open in the app that handles notebooks, such as Jupyter or VS Code'
  open.addEventListener('click', (e) => {
    e.preventDefault()
    onOpen()
  })
  header.append(open)
  const body = el('div', 'nb-body')
  for (const cell of notebook.cells) body.append(renderCell(cell, notebook.language))
  if (!notebook.cells.length) body.append(el('div', 'nb-unsupported', 'This notebook has no cells.'))
  wrap.replaceChildren(header, body)
}

/** Loads a notebook attachment into `wrap`. Links inside open in the browser, never inside Prem's window. */
export function loadNotebookPreview(wrap: HTMLElement, path: string, host: EditorHost): void {
  const name = path.slice(path.lastIndexOf('/') + 1)
  wrap.textContent = `Loading ${name}…`
  wrap.addEventListener('click', (e) => {
    const link = (e.target as HTMLElement).closest('a')
    if (!link) return
    e.preventDefault()
    const href = link.getAttribute('href') ?? ''
    if (/^https?:/i.test(href)) host.openExternal(href)
  })
  host
    .loadFile(path)
    .then((data) =>
      renderNotebook(wrap, parseNotebook(new TextDecoder().decode(data)), name, () => host.openFile(path))
    )
    .catch((err: unknown) => {
      wrap.className = 'cm-attachment cm-attachment-missing'
      wrap.textContent = `${name}: ${err instanceof Error ? err.message : "can't be shown"}`
    })
}
