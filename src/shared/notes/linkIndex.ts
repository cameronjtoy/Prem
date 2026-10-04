import { isInside, isMarkdown, noteTitle, TEMPLATES_FOLDER } from '../vault/paths'
import { createResolver, type Resolver } from './resolve'
import { parseFrontmatter } from './frontmatter'
import { summarizeBox, summarizeSample } from '../records/samples'
import { summarizeJob, summarizeWorkflow } from '../records/workflows'
import type {
  Backlink,
  BoxSummary,
  SampleIndex,
  SampleSummary,
  IndexSummary,
  JobSummary,
  NoteLinks,
  WorkflowSummary,
  GraphLink,
  GraphNode,
  LinkIndexSnapshot,
  OutgoingLink,
  ParsedLink,
  VaultPath
} from '../vault/types'
import { parseWikilinks } from './wikilinks'

interface IndexedNote {
  /** Set for job and workflow notes, which the board shows. */
  job?: JobSummary
  workflow?: WorkflowSummary
  /** Set for sample and box notes, which the Samples view shows. */
  sample?: SampleSummary
  box?: BoxSummary
  links: ParsedLink[]
  /** Only the lines that contain links, keyed by line number, for backlink snippets. */
  lines: Map<number, string>
}

/**
 * In-memory wikilink index for a vault. Notes are re-parsed individually when they change;
 * backlinks and the graph are derived from the stored links when a snapshot is taken.
 */
export class LinkIndex {
  private notes = new Map<VaultPath, IndexedNote>()
  private resolver: Resolver | null = null
  private version = 0
  /** The full snapshot for the current version, worked out once however many times it's asked for. */
  private cached: LinkIndexSnapshot | null = null
  private cachedSamples: (SampleIndex & { version: number }) | null = null

  constructor(private readonly excludedFolders: VaultPath[] = [TEMPLATES_FOLDER]) {}

  build(files: { path: VaultPath; content: string }[]): void {
    this.notes.clear()
    for (const f of files) this.parseInto(f.path, f.content)
    this.touch(true)
  }

  upsert(path: VaultPath, content: string): void {
    if (!isMarkdown(path)) return
    const isNew = !this.notes.has(path)
    this.parseInto(path, content)
    this.touch(isNew)
  }

  remove(path: VaultPath): void {
    if (this.notes.delete(path)) this.touch(true)
  }

  removeFolder(folder: VaultPath): void {
    let changed = false
    for (const p of this.notes.keys()) {
      if (isInside(p, folder)) changed = this.notes.delete(p) || changed
    }
    if (changed) this.touch(true)
  }

  has(path: VaultPath): boolean {
    return this.notes.has(path)
  }

  resolve(target: string, fromPath?: VaultPath): VaultPath | null {
    this.resolver ??= createResolver(this.notes.keys())
    return this.resolver(target, fromPath)
  }

  /** The small part the window is always sent: the version, workflows and jobs. */
  summary(): IndexSummary {
    const { version, workflows, jobs } = this.snapshot()
    return { version, workflows, jobs }
  }

  /** Every sample and box, for the Samples view. Asked for only while it's open, since a lab can have thousands. */
  samples(): SampleIndex {
    if (this.cachedSamples?.version !== this.version) {
      const samples: SampleSummary[] = []
      const boxes: BoxSummary[] = []
      for (const [path, note] of this.notes) {
        if (this.excludedFolders.some((f) => isInside(path, f))) continue
        if (note.sample) samples.push(note.sample)
        if (note.box) boxes.push(note.box)
      }
      samples.sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      this.cachedSamples = { version: this.version, samples, boxes }
    }
    const { samples, boxes } = this.cachedSamples
    return { samples, boxes }
  }

  /** The links into and out of one note. */
  linksFor(path: VaultPath): NoteLinks {
    const snap = this.snapshot()
    return { backlinks: snap.backlinks[path] ?? [], outgoing: snap.outgoing[path] ?? [] }
  }

  snapshot(): LinkIndexSnapshot {
    if (this.cached?.version === this.version) return this.cached
    this.cached = this.compute()
    return this.cached
  }

  private compute(): LinkIndexSnapshot {
    const backlinks: Record<VaultPath, Backlink[]> = {}
    const outgoing: Record<VaultPath, OutgoingLink[]> = {}
    const nodes = new Map<string, GraphNode>()
    const links: GraphLink[] = []
    const excluded = (p: VaultPath): boolean => this.excludedFolders.some((f) => isInside(p, f))

    for (const path of this.notes.keys()) {
      if (!excluded(path)) nodes.set(path, { id: path, name: noteTitle(path), resolved: true, degree: 0 })
    }

    for (const [source, note] of this.notes) {
      if (excluded(source)) continue
      const out: OutgoingLink[] = []
      const edges = new Set<string>()
      for (const link of note.links) {
        const resolved = this.resolve(link.target, source)
        out.push({ target: link.target, resolved })
        if (resolved && excluded(resolved)) continue

        let nodeId: string
        if (resolved) {
          nodeId = resolved
          if (resolved !== source) {
            const list = (backlinks[resolved] ??= [])
            let entry = list.find((b) => b.source === source)
            if (!entry) list.push((entry = { source, snippets: [] }))
            const snippet = note.lines.get(link.line)?.trim()
            if (snippet && !entry.snippets.includes(snippet)) entry.snippets.push(snippet)
          }
        } else {
          nodeId = `unresolved:${link.target.toLowerCase()}`
          if (!nodes.has(nodeId)) {
            nodes.set(nodeId, { id: nodeId, name: link.target, resolved: false, degree: 0 })
          }
        }

        if (nodeId === source || edges.has(nodeId)) continue
        edges.add(nodeId)
        links.push({ source, target: nodeId })
        nodes.get(source)!.degree++
        nodes.get(nodeId)!.degree++
      }
      outgoing[source] = out
    }

    for (const list of Object.values(backlinks)) list.sort((a, b) => a.source.localeCompare(b.source))

    const jobs: JobSummary[] = []
    const workflows: WorkflowSummary[] = []
    for (const [path, note] of this.notes) {
      if (excluded(path)) continue
      if (note.job) jobs.push(note.job)
      if (note.workflow) workflows.push(note.workflow)
    }
    return {
      version: this.version,
      backlinks,
      outgoing,
      graph: { nodes: [...nodes.values()], links },
      workflows,
      jobs
    }
  }

  private parseInto(path: VaultPath, content: string): void {
    const links = parseWikilinks(content)
    const lines = new Map<number, string>()
    if (links.length) {
      const all = content.split('\n')
      for (const l of links) lines.set(l.line, all[l.line] ?? '')
    }
    const note: IndexedNote = { links, lines }
    // Read the type once: this runs for every note in the vault when it opens.
    const type = /^---\r?\n/.test(content) ? parseFrontmatter(content).fields.type : undefined
    if (type === 'job') note.job = summarizeJob(path, content)
    else if (type === 'workflow') note.workflow = summarizeWorkflow(path, content)
    else if (type === 'sample') note.sample = summarizeSample(path, content)
    else if (type === 'box') note.box = summarizeBox(path, content)
    this.notes.set(path, note)
  }

  private touch(pathsChanged: boolean): void {
    if (pathsChanged) this.resolver = null
    this.version++
  }
}
