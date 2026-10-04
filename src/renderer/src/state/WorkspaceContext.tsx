import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { VaultError } from '@shared/vault/errors'
import { parseFrontmatter } from '@shared/notes/frontmatter'
import {
  basename,
  dirname,
  isInside,
  isMarkdown,
  joinPath,
  noteTitle,
  sanitizeFileName,
  stripMd
} from '@shared/vault/paths'
import { createRun, runPath } from '@shared/records/runs'
import {
  completeStage,
  createJob,
  jobPath,
  jobState,
  jobWorkflow,
  redoStage,
  rerunJob as rerunJobText,
  tagRun
} from '@shared/records/workflows'
import { formatDate } from '@shared/notes/templates'
import type { RenameResult, VaultPath } from '@shared/vault/types'
import { errorMessage, vaultClient } from '../services/vaultClient'
import { useNotebookFolder, useSettings } from './SettingsContext'
import { useVault } from './VaultContext'

export type MainView = 'editor' | 'graph' | 'board'

/** Lets the workspace save or drop the open editor's pending edits before moving files around. */
export interface EditorHandle {
  path: VaultPath
  flush(): Promise<void>
  discard(): void
}

interface OpenNote {
  path: VaultPath
  cursor: number | null
}

/** A note or folder being named in the file list. Nothing exists on disk until it's committed. */
export interface Draft {
  kind: 'note' | 'folder'
  folder: VaultPath
}

interface WorkspaceState {
  active: OpenNote | null
  draft: Draft | null
  view: MainView
  renamingPath: VaultPath | null
  templatePickerFolder: VaultPath | null
  notice: string | null
  /** Errors and refusals are 'error'; confirmations such as a finished export are 'info'. */
  noticeKind: 'error' | 'info'
  setView(view: MainView): void
  openNote(path: VaultPath, cursor?: number | null): void
  openLink(target: string, fromPath?: VaultPath): Promise<void>
  /** Starts naming a new note in the file list. It's created only when the name is confirmed with Enter. */
  createNote(folder: VaultPath): Promise<void>
  /** Starts naming a new folder in the file list. It's created only when the name is confirmed with Enter. */
  createFolder(parent: VaultPath): Promise<void>
  /** Creates the note or folder being named. Returns why it couldn't, e.g. the name is taken, or null. */
  commitDraft(name: string): Promise<string | null>
  cancelDraft(): void
  createFromTemplate(templatePath: VaultPath, title: string, folder: VaultPath): Promise<void>
  /** Opens today's notebook entry, creating it from the daily template the first time. */
  openToday(): Promise<void>
  /** Starts a run of a protocol in your notebook and opens it. */
  /**
   * Starts a run of a protocol and returns its path. With `job`, the run is linked to that job's stage;
   * with `open: false` it isn't opened, so the caller can update the job first.
   */
  startRun(
    protocolPath: VaultPath,
    options?: { job?: { title: string; stage: string }; open?: boolean }
  ): Promise<VaultPath | null>
  /** Starts a job of a workflow, filed under Jobs/, and opens it. */
  newJob(workflowPath: VaultPath): Promise<void>
  /** Starts a new job with a job's stages and samples, linked back to it, and opens it. */
  rerunJob(jobPath: VaultPath): Promise<void>
  /**
   * Completes a job's current stage from outside the job (the board), asking first if the stage's run isn't
   * complete. Resolves to whether the job moved on.
   */
  advanceJob(jobPath: VaultPath): Promise<boolean>
  /** Sends a job back to an earlier stage, with a reason noted in the job. Resolves to whether it went back. */
  sendJobBack(jobPath: VaultPath, stage: string, reason: string): Promise<boolean>
  startRename(path: VaultPath | null): void
  rename(path: VaultPath, newName: string): Promise<void>
  remove(path: VaultPath): Promise<void>
  /** Saves a note, or every note in a folder, as a PDF with its signatures and history check. */
  exportPdf(path: VaultPath): Promise<void>
  /** Zips the whole vault, history included, to a file you choose. */
  backupVault(): Promise<void>
  showTemplatePicker(folder: VaultPath | null): void
  showNotice(message: string | null): void
  registerEditor(handle: EditorHandle | null): void
  /** Folder new notes go into: the open note's folder, or the vault root. */
  currentFolder(): VaultPath
  /** Back and forward through the notes you've opened, like a browser. */
  goBack(): void
  goForward(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** Says what happened to links elsewhere after a rename, or nothing if no other note linked to it. */
function renameReport({ updated, locked, readOnly }: RenameResult): { text: string; kind: 'error' | 'info' } | null {
  const parts: string[] = []
  if (updated.length) parts.push(`Updated links in ${count(updated.length, 'note', 'notes')}.`)
  if (locked.length) {
    const names = locked.map((p) => stripMd(basename(p))).join(', ')
    parts.push(
      `${count(locked.length, 'signed note still links', 'signed notes still link')} to the old name: ${names}.`
    )
  }
  if (readOnly.length)
    parts.push(`${count(readOnly.length, "note you can't edit links", "notes you can't edit link")} to the old name.`)
  if (!parts.length) return null
  return { text: parts.join(' '), kind: locked.length || readOnly.length ? 'error' : 'info' }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { info, entries, resolver, subscribe, refresh, canWrite } = useVault()
  const notebook = useNotebookFolder(info?.user)
  const confirmTrash = useSettings().values['notebook.confirmTrash']
  const [active, setActive] = useState<OpenNote | null>(null)
  const [view, setView] = useState<MainView>('editor')
  const [renamingPath, setRenamingPath] = useState<VaultPath | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [templatePickerFolder, setTemplatePickerFolder] = useState<VaultPath | null>(null)
  const [notice, setNoticeText] = useState<string | null>(null)
  const [noticeKind, setNoticeKind] = useState<'error' | 'info'>('error')
  const setNotice = useCallback((message: string | null, kind: 'error' | 'info' = 'error') => {
    setNoticeText(message)
    setNoticeKind(kind)
  }, [])
  const editor = useRef<EditorHandle | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active
  // Notes you came from and went back from. Kept in refs: they change on every navigation but nothing renders them.
  const trail = useRef<{ back: VaultPath[]; forward: VaultPath[] }>({ back: [], forward: [] })
  const entriesRef = useRef(entries)
  entriesRef.current = entries

  useEffect(() => {
    setActive(null)
    setView('editor')
    trail.current = { back: [], forward: [] }
  }, [info])

  // If the open note disappears from disk, drop it without saving it back.
  useEffect(
    () =>
      subscribe((changes) => {
        const current = activeRef.current
        if (!current) return
        if (changes.some((c) => c.type === 'deleted' && isInside(current.path, c.path))) {
          editor.current?.discard()
          setActive(null)
        }
      }),
    [subscribe]
  )

  const fail = useCallback((err: unknown) => setNotice(errorMessage(err)), [setNotice])

  const openNote = useCallback(
    (path: VaultPath, cursor: number | null = null) => {
      // Attachments open in their own app; only notes open in the editor.
      if (!isMarkdown(path)) return void vaultClient.openFile(path).catch(fail)
      const current = activeRef.current
      if (current && current.path !== path) {
        trail.current.back = [...trail.current.back.slice(-99), current.path]
        trail.current.forward = []
      }
      setActive({ path, cursor })
      setView('editor')
    },
    [fail]
  )

  const exists = useCallback(
    (path: VaultPath) => entriesRef.current.some((e) => e.kind === 'file' && e.path === path),
    []
  )

  /** Moves one step along `from`, skipping notes that were deleted or moved, and records where you were in `to`. */
  const step = useCallback(
    (from: 'back' | 'forward') => {
      const to = from === 'back' ? 'forward' : 'back'
      const t = trail.current
      let target: VaultPath | undefined
      while ((target = t[from].pop()) && !exists(target)) {
        // skip
      }
      if (!target) return
      const current = activeRef.current
      if (current) t[to].push(current.path)
      setActive({ path: target, cursor: null })
      setView('editor')
    },
    [exists]
  )
  const goBack = useCallback(() => step('back'), [step])
  const goForward = useCallback(() => step('forward'), [step])
  const canGoBack = useCallback(() => trail.current.back.some(exists), [exists])
  const canGoForward = useCallback(() => trail.current.forward.some(exists), [exists])

  const createFromTemplate = useCallback(
    async (templatePath: VaultPath, title: string, folder: VaultPath) => {
      try {
        const created = await vaultClient.createFromTemplate(templatePath, title, folder)
        await refresh()
        openNote(created.path, created.cursor)
      } catch (err) {
        fail(err)
      }
    },
    [refresh, openNote, fail]
  )

  const openToday = useCallback(async () => {
    try {
      const { path, cursor } = await vaultClient.openDaily(formatDate(new Date(), 'YYYY-MM-DD'))
      await refresh()
      openNote(path, cursor)
    } catch (err) {
      fail(err)
    }
  }, [refresh, openNote, fail])

  /** Writes a new note at `base`, or at `base 1`, `base 2`… if that's taken, and returns where it went. */
  const writeNew = useCallback(
    async (base: VaultPath, content: string): Promise<VaultPath> => {
      for (let n = 0; ; n++) {
        const path = n === 0 ? base : base.replace(/\.md$/, ` ${n}.md`)
        try {
          await vaultClient.write(path, content, { createOnly: true })
          await refresh()
          return path
        } catch (err) {
          if (!(err instanceof VaultError && err.code === 'EXISTS') || n >= 20) throw err
        }
      }
    },
    [refresh]
  )

  const startRun = useCallback(
    async (protocolPath: VaultPath, options: { job?: { title: string; stage: string }; open?: boolean } = {}) => {
      try {
        // Save pending edits to the open note first, so the run copies what's on screen.
        await editor.current?.flush()
        const now = new Date()
        const protocol = await vaultClient.read(protocolPath)
        let content = createRun(protocolPath, protocol.content, { now, operator: info?.author ?? '' })
        if (options.job) content = tagRun(content, options.job.title, options.job.stage)
        const path = await writeNew(runPath(notebook, protocolPath, now), content)
        if (options.open !== false) openNote(path)
        return path
      } catch (err) {
        fail(err)
        return null
      }
    },
    [info, notebook, writeNew, openNote, fail]
  )

  const newJob = useCallback(
    async (workflowPath: VaultPath) => {
      try {
        await editor.current?.flush()
        const now = new Date()
        const workflow = await vaultClient.read(workflowPath)
        const content = createJob(workflowPath, workflow.content, { now, author: info?.author ?? '' })
        openNote(await writeNew(jobPath(workflowPath, now), content))
      } catch (err) {
        fail(err)
      }
    },
    [info, writeNew, openNote, fail]
  )

  const rerunJob = useCallback(
    async (path: VaultPath) => {
      try {
        await editor.current?.flush()
        const now = new Date()
        const job = await vaultClient.read(path)
        const content = rerunJobText(path, job.content, { now, author: info?.author ?? '' })
        const workflow = jobWorkflow(job.content) ?? noteTitle(path)
        openNote(await writeNew(jobPath(`${workflow}.md`, now), content))
      } catch (err) {
        fail(err)
      }
    },
    [info, writeNew, openNote, fail]
  )

  /** Rewrites a job note that isn't open in the editor, failing if it changed in the meantime. */
  const changeJob = useCallback(
    async (path: VaultPath, change: (text: string) => Promise<string | null> | string | null): Promise<boolean> => {
      try {
        await editor.current?.flush()
        if ((await vaultClient.recordStatus(path)).locked) {
          setNotice(`${noteTitle(path)} is signed, so it can't change any more.`)
          return false
        }
        const file = await vaultClient.read(path)
        const next = await change(file.content)
        if (next === null || next === file.content) return false
        await vaultClient.write(path, next, { expectedVersion: file.version })
        return true
      } catch (err) {
        fail(err)
        return false
      }
    },
    [fail, setNotice]
  )

  const advanceJob = useCallback(
    (path: VaultPath) =>
      changeJob(path, async (text) => {
        const state = jobState(text)
        if (!state.current) return null
        const run = state.openRow?.run ? resolver(state.openRow.run, path) : null
        if (run) {
          const status = await vaultClient
            .read(run)
            .then((r) => parseFrontmatter(r.content).fields.status)
            .catch(() => undefined)
          if (
            status !== 'complete' &&
            !window.confirm(`The ${state.current.name} run isn't complete. Complete the stage anyway?`)
          )
            return null
        }
        return completeStage(text, { by: info?.author ?? '', now: new Date() })
      }),
    [changeJob, resolver, info]
  )

  const sendJobBack = useCallback(
    (path: VaultPath, stage: string, reason: string) =>
      changeJob(path, (text) => redoStage(text, stage, { by: info?.author ?? '', now: new Date(), reason })),
    [changeJob, info]
  )

  const openLink = useCallback(
    async (target: string, fromPath?: VaultPath) => {
      const resolved = resolver(target, fromPath)
      if (resolved) return openNote(resolved)
      const folder = target.includes('/') ? dirname(target) : ''
      // On a team vault the note may exist in a folder you can't see, so don't offer to create it.
      if (!canWrite(folder)) return setNotice(`"${target}" isn't a note you have access to.`)
      await createFromTemplate('', basename(target), folder)
    },
    [resolver, openNote, createFromTemplate, canWrite, setNotice]
  )

  const createNote = useCallback((folder: VaultPath) => {
    setRenamingPath(null)
    setDraft({ kind: 'note', folder })
    return Promise.resolve()
  }, [])

  const createFolder = useCallback((parent: VaultPath) => {
    setRenamingPath(null)
    setDraft({ kind: 'folder', folder: parent })
    return Promise.resolve()
  }, [])

  const cancelDraft = useCallback(() => setDraft(null), [])

  const commitDraft = useCallback(
    async (rawName: string): Promise<string | null> => {
      const current = draft
      if (!current) return null
      const name = sanitizeFileName(rawName.trim().replace(/\.md$/i, ''))
      if (!name) {
        setDraft(null)
        return null
      }
      const path = joinPath(current.folder, current.kind === 'note' ? `${name}.md` : name)
      if (entries.some((e) => e.path.toLowerCase() === path.toLowerCase())) {
        return `A ${current.kind === 'note' ? 'note' : 'folder'} called "${name}" is already here.`
      }
      try {
        if (current.kind === 'note') {
          const created = await vaultClient.createFromTemplate('', name, current.folder)
          setDraft(null)
          await refresh()
          openNote(created.path)
        } else {
          await vaultClient.mkdir(path)
          setDraft(null)
          await refresh()
        }
        return null
      } catch (err) {
        return errorMessage(err)
      }
    },
    [draft, entries, refresh, openNote]
  )

  const rename = useCallback(
    async (path: VaultPath, newName: string) => {
      setRenamingPath(null)
      const isFile = path.toLowerCase().endsWith('.md')
      const name = sanitizeFileName(newName.replace(/\.md$/i, ''))
      const to = joinPath(dirname(path), isFile ? `${name}.md` : name)
      if (to === path) return
      try {
        const current = activeRef.current
        const affectsActive = current && isInside(current.path, path)
        // Save first: the open note may link to what's moving, and its links are about to be rewritten.
        await editor.current?.flush()
        const result = await vaultClient.rename(path, to)
        // Switch before the watcher reports the old path as deleted, which would close the note.
        if (affectsActive && current) setActive({ path: to + current.path.slice(path.length), cursor: null })
        const moved = (p: VaultPath): VaultPath => (isInside(p, path) ? to + p.slice(path.length) : p)
        trail.current = { back: trail.current.back.map(moved), forward: trail.current.forward.map(moved) }
        await refresh()
        const report = renameReport(result)
        if (report) setNotice(report.text, report.kind)
      } catch (err) {
        fail(err)
      }
    },
    [refresh, fail, setNotice]
  )

  const remove = useCallback(
    async (path: VaultPath) => {
      const label = basename(path)
      if (confirmTrash && !window.confirm(`Move "${label}" to the trash?`)) return
      try {
        const current = activeRef.current
        if (current && isInside(current.path, path)) {
          editor.current?.discard()
          setActive(null)
        }
        await vaultClient.remove(path)
        await refresh()
      } catch (err) {
        fail(err)
      }
    },
    [confirmTrash, refresh, fail]
  )

  const exportPdf = useCallback(
    async (path: VaultPath) => {
      try {
        // Print what's on screen, not what was last saved.
        const current = activeRef.current
        if (current && isInside(current.path, path)) await editor.current?.flush()
        const saved = await vaultClient.exportPdf(path)
        if (saved) {
          const what = saved.notes === 1 ? 'Exported' : `Exported ${saved.notes} entries`
          setNotice(`${what} to ${saved.file}`, 'info')
        }
      } catch (err) {
        fail(err)
      }
    },
    [fail, setNotice]
  )

  const backupVault = useCallback(async () => {
    try {
      // The backup holds what's on screen, not what was last saved.
      await editor.current?.flush()
      const saved = await vaultClient.backupVault()
      if (saved) {
        const size = saved.bytes >= 1e6 ? `${(saved.bytes / 1e6).toFixed(1)} MB` : `${Math.ceil(saved.bytes / 1e3)} KB`
        setNotice(`Backed up ${saved.files} files (${size}) to ${saved.file}`, 'info')
      }
    } catch (err) {
      fail(err)
    }
  }, [fail, setNotice])

  const registerEditor = useCallback((handle: EditorHandle | null) => {
    editor.current = handle
  }, [])

  const currentFolder = useCallback(() => (activeRef.current ? dirname(activeRef.current.path) : ''), [])

  const value = useMemo<WorkspaceState>(
    () => ({
      active,
      draft,
      view,
      renamingPath,
      templatePickerFolder,
      notice,
      noticeKind,
      setView,
      openNote,
      openLink,
      createNote,
      createFolder,
      commitDraft,
      cancelDraft,
      createFromTemplate,
      openToday,
      startRun,
      newJob,
      rerunJob,
      advanceJob,
      sendJobBack,
      startRename: (path: VaultPath | null) => {
        setDraft(null)
        setRenamingPath(path)
      },
      rename,
      remove,
      exportPdf,
      backupVault,
      showTemplatePicker: setTemplatePickerFolder,
      showNotice: (message: string | null) => setNotice(message),
      registerEditor,
      currentFolder,
      goBack,
      goForward,
      canGoBack,
      canGoForward
    }),
    [
      active,
      draft,
      view,
      renamingPath,
      templatePickerFolder,
      notice,
      noticeKind,
      setNotice,
      openNote,
      openLink,
      createNote,
      createFolder,
      commitDraft,
      cancelDraft,
      createFromTemplate,
      openToday,
      startRun,
      newJob,
      rerunJob,
      advanceJob,
      sendJobBack,
      rename,
      remove,
      exportPdf,
      backupVault,
      registerEditor,
      currentFolder,
      goBack,
      goForward,
      canGoBack,
      canGoForward
    ]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}
