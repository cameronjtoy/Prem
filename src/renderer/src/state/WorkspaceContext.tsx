import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { VaultError } from '@shared/errors'
import { notebookFolder } from '@shared/notebook'
import { basename, dirname, isInside, joinPath, sanitizeFileName } from '@shared/paths'
import { createRun, runPath } from '@shared/runs'
import { formatDate } from '@shared/templates'
import type { VaultPath } from '@shared/types'
import { errorMessage, vaultClient } from '../services/vaultClient'
import { useVault } from './VaultContext'

export type MainView = 'editor' | 'graph'

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

interface WorkspaceState {
  active: OpenNote | null
  view: MainView
  renamingPath: VaultPath | null
  templatePickerFolder: VaultPath | null
  notice: string | null
  setView(view: MainView): void
  openNote(path: VaultPath, cursor?: number | null): void
  openLink(target: string, fromPath?: VaultPath): Promise<void>
  createNote(folder: VaultPath): Promise<void>
  createFolder(parent: VaultPath): Promise<void>
  createFromTemplate(templatePath: VaultPath, title: string, folder: VaultPath): Promise<void>
  /** Opens today's notebook entry, creating it from the daily template the first time. */
  openToday(): Promise<void>
  /** Starts a run of a protocol in your notebook and opens it. */
  startRun(protocolPath: VaultPath): Promise<void>
  startRename(path: VaultPath | null): void
  rename(path: VaultPath, newName: string): Promise<void>
  remove(path: VaultPath): Promise<void>
  showTemplatePicker(folder: VaultPath | null): void
  showNotice(message: string | null): void
  registerEditor(handle: EditorHandle | null): void
  /** Folder new notes go into: the open note's folder, or the vault root. */
  currentFolder(): VaultPath
}

const WorkspaceContext = createContext<WorkspaceState | null>(null)

async function freePath(folder: VaultPath, name: string, ext: string): Promise<VaultPath> {
  const existing = new Set((await vaultClient.list()).map((e) => e.path.toLowerCase()))
  for (let n = 0; ; n++) {
    const path = joinPath(folder, `${n === 0 ? name : `${name} ${n}`}${ext}`)
    if (!existing.has(path.toLowerCase())) return path
  }
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { info, resolver, subscribe, refresh, canWrite } = useVault()
  const [active, setActive] = useState<OpenNote | null>(null)
  const [view, setView] = useState<MainView>('editor')
  const [renamingPath, setRenamingPath] = useState<VaultPath | null>(null)
  const [templatePickerFolder, setTemplatePickerFolder] = useState<VaultPath | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const editor = useRef<EditorHandle | null>(null)
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    setActive(null)
    setView('editor')
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

  const fail = useCallback((err: unknown) => setNotice(errorMessage(err)), [])

  const openNote = useCallback((path: VaultPath, cursor: number | null = null) => {
    setActive({ path, cursor })
    setView('editor')
  }, [])

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

  const startRun = useCallback(
    async (protocolPath: VaultPath) => {
      try {
        // Save pending edits to the protocol first, so the run copies what's on screen.
        await editor.current?.flush()
        const now = new Date()
        const protocol = await vaultClient.read(protocolPath)
        const content = createRun(protocolPath, protocol.content, { now, operator: info?.author ?? '' })
        const base = runPath(notebookFolder(info?.user), protocolPath, now)
        for (let n = 0; ; n++) {
          const path = n === 0 ? base : base.replace(/\.md$/, ` ${n}.md`)
          try {
            await vaultClient.write(path, content, { createOnly: true })
            await refresh()
            return openNote(path)
          } catch (err) {
            if (!(err instanceof VaultError && err.code === 'EXISTS') || n >= 20) throw err
          }
        }
      } catch (err) {
        fail(err)
      }
    },
    [info, refresh, openNote, fail]
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
    [resolver, openNote, createFromTemplate, canWrite]
  )

  const createNote = useCallback(
    async (folder: VaultPath) => {
      try {
        const created = await vaultClient.createFromTemplate('', 'Untitled', folder)
        await refresh()
        openNote(created.path)
        setRenamingPath(created.path)
      } catch (err) {
        fail(err)
      }
    },
    [refresh, openNote, fail]
  )

  const createFolder = useCallback(
    async (parent: VaultPath) => {
      try {
        const path = await freePath(parent, 'New folder', '')
        await vaultClient.mkdir(path)
        await refresh()
        setRenamingPath(path)
      } catch (err) {
        fail(err)
      }
    },
    [refresh, fail]
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
        if (affectsActive) await editor.current?.flush()
        await vaultClient.rename(path, to)
        // Switch before the watcher reports the old path as deleted, which would close the note.
        if (affectsActive && current) setActive({ path: to + current.path.slice(path.length), cursor: null })
        await refresh()
      } catch (err) {
        fail(err)
      }
    },
    [refresh, fail]
  )

  const remove = useCallback(
    async (path: VaultPath) => {
      const label = basename(path)
      if (!window.confirm(`Move "${label}" to the trash?`)) return
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
    [refresh, fail]
  )

  const registerEditor = useCallback((handle: EditorHandle | null) => {
    editor.current = handle
  }, [])

  const currentFolder = useCallback(() => (activeRef.current ? dirname(activeRef.current.path) : ''), [])

  const value = useMemo<WorkspaceState>(
    () => ({
      active,
      view,
      renamingPath,
      templatePickerFolder,
      notice,
      setView,
      openNote,
      openLink,
      createNote,
      createFolder,
      createFromTemplate,
      openToday,
      startRun,
      startRename: setRenamingPath,
      rename,
      remove,
      showTemplatePicker: setTemplatePickerFolder,
      showNotice: setNotice,
      registerEditor,
      currentFolder
    }),
    [
      active,
      view,
      renamingPath,
      templatePickerFolder,
      notice,
      openNote,
      openLink,
      createNote,
      createFolder,
      createFromTemplate,
      openToday,
      startRun,
      rename,
      remove,
      registerEditor,
      currentFolder
    ]
  )

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceState {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside <WorkspaceProvider>')
  return ctx
}
