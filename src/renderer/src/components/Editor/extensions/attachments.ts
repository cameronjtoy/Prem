import { EditorView, WidgetType } from '@codemirror/view'
import { attachmentKind, extension, MAX_ATTACHMENT_BYTES } from '@shared/attachments'
import { parseDelimited } from '@shared/csv'
import { hostFacet, type EditorHost } from './host'

const PREVIEW_ROWS = 25
const MIME: Record<string, string> = { svg: 'image/svg+xml' }

/** Object URLs for attachments already loaded, so scrolling or retyping doesn't fetch them again. */
const urls = new Map<string, Promise<string>>()

function objectUrl(host: EditorHost, path: string): Promise<string> {
  let url = urls.get(path)
  if (!url) {
    url = host
      .loadFile(path)
      .then((data) =>
        URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: MIME[extension(path)] ?? '' }))
      )
    url.catch(() => urls.delete(path))
    urls.set(path, url)
  }
  return url
}

function fileName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** An embedded attachment: an image, a table preview for CSV/TSV, or a card that opens the file. */
export class AttachmentWidget extends WidgetType {
  constructor(
    readonly path: string,
    readonly alt: string
  ) {
    super()
  }

  eq(other: AttachmentWidget): boolean {
    return other.path === this.path && other.alt === this.alt
  }

  toDOM(view: EditorView): HTMLElement {
    const host = view.state.facet(hostFacet)
    const kind = attachmentKind(this.path)
    const wrap = document.createElement('span')
    wrap.className = `cm-attachment cm-attachment-${kind}`
    wrap.title = `${fileName(this.path)} — click to open`
    wrap.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return
      e.preventDefault()
      host.openFile(this.path)
    })

    const fail = (err: unknown): void => {
      wrap.className = 'cm-attachment cm-attachment-missing'
      wrap.textContent = `${fileName(this.path)} — ${err instanceof Error ? err.message : "can't be loaded"}`
    }

    if (kind === 'image') {
      const img = document.createElement('img')
      img.alt = this.alt
      wrap.append(img)
      objectUrl(host, this.path).then((src) => (img.src = src), fail)
    } else if (kind === 'table') {
      wrap.textContent = `Loading ${fileName(this.path)}…`
      host
        .loadFile(this.path)
        .then((data) => this.renderTable(wrap, new TextDecoder().decode(data)))
        .catch(fail)
    } else {
      wrap.textContent = `📎 ${fileName(this.path)}`
    }
    return wrap
  }

  private renderTable(wrap: HTMLElement, text: string): void {
    const separator = extension(this.path) === 'tsv' ? '\t' : ','
    const { rows, truncated } = parseDelimited(text, separator, PREVIEW_ROWS + 1)
    const caption = document.createElement('span')
    caption.className = 'cm-attachment-caption'
    caption.textContent = `📊 ${fileName(this.path)}`
    const table = document.createElement('table')
    rows.slice(0, PREVIEW_ROWS + 1).forEach((cells, i) => {
      const tr = table.insertRow()
      for (const cell of cells) {
        const td = document.createElement(i === 0 ? 'th' : 'td')
        td.textContent = cell
        tr.append(td)
      }
    })
    wrap.replaceChildren(caption, table)
    if (truncated || rows.length > PREVIEW_ROWS + 1) {
      const more = document.createElement('span')
      more.className = 'cm-attachment-caption'
      more.textContent = `Showing the first ${PREVIEW_ROWS} rows. Click to open the whole file.`
      wrap.append(more)
    }
  }

  ignoreEvent(): boolean {
    return true
  }
}

async function attachFiles(view: EditorView, files: File[], pos: number): Promise<void> {
  const host = view.state.facet(hostFacet)
  const parts: string[] = []
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      host.notify(
        `"${file.name}" is over ${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB. Keep large raw data on shared storage and link to it.`
      )
      continue
    }
    try {
      parts.push(await host.addAttachment(file.name || 'Pasted file', new Uint8Array(await file.arrayBuffer())))
    } catch (err) {
      host.notify(`Couldn't attach "${file.name}": ${err instanceof Error ? err.message : err}`)
    }
  }
  if (!parts.length) return
  const at = Math.min(pos, view.state.doc.length)
  const line = view.state.doc.lineAt(at)
  // Each attachment goes on its own line, so previews don't break up a sentence.
  const before = at > line.from ? '\n' : ''
  const after = at < line.to ? '\n' : ''
  const insert = before + parts.join('\n') + after
  view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: 'input.drop' })
}

function filesOf(data: DataTransfer | null): File[] {
  return data ? [...data.files] : []
}

/** Dropping or pasting files into a note stores them as attachments and embeds them where they landed. */
export const attachmentInput = EditorView.domEventHandlers({
  drop(event, view) {
    const files = filesOf(event.dataTransfer)
    if (!files.length) return false
    event.preventDefault()
    if (view.state.readOnly) return true
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head
    void attachFiles(view, files, pos)
    return true
  },
  paste(event, view) {
    const files = filesOf(event.clipboardData)
    if (!files.length) return false
    event.preventDefault()
    if (view.state.readOnly) return true
    const named = files.map((f) =>
      f.name && f.name !== 'image.png'
        ? f
        : new File([f], `Pasted image ${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.png`, {
            type: f.type
          })
    )
    void attachFiles(view, named, view.state.selection.main.head)
    return true
  }
})
