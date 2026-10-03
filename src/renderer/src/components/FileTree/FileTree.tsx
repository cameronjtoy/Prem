import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { dirname, isMarkdown } from '@shared/vault/paths'
import { useVault } from '../../state/VaultContext'
import { useWorkspace, type Draft } from '../../state/WorkspaceContext'
import { keyFor } from '../../commands/registry'
import { ContextMenu, type MenuItem, type MenuState } from '../ContextMenu'
import {
  ChevronIcon,
  CollapseIcon,
  FileIcon,
  FolderIcon,
  NewFolderIcon,
  NewNoteIcon,
  SidebarLeftIcon,
  TemplateIcon
} from '../icons'
import { buildTree, type TreeNode } from './buildTree'

function loadExpanded(key: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function saveExpanded(key: string, expanded: Set<string>): void {
  try {
    localStorage.setItem(key, JSON.stringify([...expanded]))
  } catch {
    // Storage may be unavailable; expansion state just won't persist.
  }
}

export function FileTree({ onHide }: { onHide(): void }) {
  const { info, entries, canWrite } = useVault()
  const ws = useWorkspace()
  const canCreate = canWrite(ws.currentFolder())
  const tree = useMemo(() => buildTree(entries), [entries])
  const storageKey = `expanded:${info?.root ?? ''}`
  const [expanded, setExpanded] = useState(() => loadExpanded(storageKey))
  const [menu, setMenu] = useState<MenuState | null>(null)

  useEffect(() => setExpanded(loadExpanded(storageKey)), [storageKey])
  useEffect(() => saveExpanded(storageKey, expanded), [storageKey, expanded])

  // Reveal the open note, anything being renamed, and the folder a new note or folder is being named in.
  const revealPath = ws.draft ? `${ws.draft.folder}/_` : (ws.renamingPath ?? ws.active?.path)
  useEffect(() => {
    if (!revealPath) return
    setExpanded((prev) => {
      const next = new Set(prev)
      for (let dir = dirname(revealPath); dir; dir = dirname(dir)) next.add(dir)
      return next.size === prev.size ? prev : next
    })
  }, [revealPath])

  const toggle = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(path)) next.add(path)
      return next
    })
  }, [])

  const openMenu = (e: MouseEvent, node: TreeNode | null): void => {
    e.preventDefault()
    e.stopPropagation()
    const folder = node ? (node.kind === 'folder' ? node.path : dirname(node.path)) : ''
    const items: (MenuItem | 'separator')[] = []
    if (canWrite(folder)) {
      items.push(
        { label: 'New note', onSelect: () => void ws.createNote(folder) },
        { label: 'New note from template…', onSelect: () => ws.showTemplatePicker(folder) },
        { label: 'New folder', onSelect: () => void ws.createFolder(folder) }
      )
    }
    if (node) {
      if (node.kind === 'folder') setExpanded((prev) => new Set(prev).add(node.path))
      if (node.kind === 'folder' || isMarkdown(node.path)) {
        if (items.length) items.push('separator')
        items.push({ label: 'Export as PDF…', onSelect: () => void ws.exportPdf(node.path) })
      }
      if (canWrite(node.path)) {
        if (items.length) items.push('separator')
        items.push(
          { label: 'Rename', onSelect: () => ws.startRename(node.path) },
          { label: 'Delete', danger: true, onSelect: () => void ws.remove(node.path) }
        )
      }
    }
    if (items.length) setMenu({ x: e.clientX, y: e.clientY, items })
  }

  return (
    <div className="file-tree">
      <div className="pane-toolbar">
        <span className="pane-title" title={info?.user ? `${info.user} on ${info.root}` : info?.root}>
          {info?.name}
        </span>
        {canCreate && (
          <>
            <button
              className="icon-button"
              title="New note (⌘N)"
              onClick={() => void ws.createNote(ws.currentFolder())}
            >
              <NewNoteIcon />
            </button>
            <button
              className="icon-button"
              title="New note from template (⌘⇧N)"
              onClick={() => ws.showTemplatePicker(ws.currentFolder())}
            >
              <TemplateIcon />
            </button>
            <button className="icon-button" title="New folder" onClick={() => void ws.createFolder(ws.currentFolder())}>
              <NewFolderIcon />
            </button>
          </>
        )}
        <button className="icon-button" title="Collapse all" onClick={() => setExpanded(new Set())}>
          <CollapseIcon />
        </button>
        <button
          className="icon-button pane-hide"
          title={`Hide the file list (${keyFor('view.toggleFiles')})`}
          aria-label="Hide the file list"
          onClick={onHide}
        >
          <SidebarLeftIcon />
        </button>
      </div>
      <div className="tree-scroll" onContextMenu={(e) => openMenu(e, null)} role="tree">
        {ws.draft?.folder === '' && <DraftRow draft={ws.draft} depth={0} />}
        {tree.length === 0 && !ws.draft && <p className="empty">This vault is empty. Create a note to get started.</p>}
        {tree.map((node) => (
          <TreeRow key={node.path} node={node} depth={0} expanded={expanded} onToggle={toggle} onMenu={openMenu} />
        ))}
      </div>
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  )
}

interface RowProps {
  node: TreeNode
  depth: number
  expanded: Set<string>
  onToggle(path: string): void
  onMenu(e: MouseEvent, node: TreeNode): void
}

function TreeRow({ node, depth, expanded, onToggle, onMenu }: RowProps) {
  const ws = useWorkspace()
  const isOpen = expanded.has(node.path)
  const isActive = ws.active?.path === node.path
  const isRenaming = ws.renamingPath === node.path

  return (
    <>
      <div
        className={`tree-row ${node.kind}${isActive ? ' active' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        role="treeitem"
        aria-expanded={node.kind === 'folder' ? isOpen : undefined}
        aria-selected={isActive}
        onClick={() => (node.kind === 'folder' ? onToggle(node.path) : ws.openNote(node.path))}
        onDoubleClick={() => ws.startRename(node.path)}
        onContextMenu={(e) => onMenu(e, node)}
        title={node.path}
      >
        {node.kind === 'folder' ? (
          <ChevronIcon className={`chevron${isOpen ? ' open' : ''}`} />
        ) : (
          <span className="chevron-spacer" />
        )}
        {isRenaming ? (
          <NameInput
            initial={node.name}
            commitOnBlur
            onDone={async (value) => {
              if (value === null || value === node.name) ws.startRename(null)
              else await ws.rename(node.path, value)
              return null
            }}
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}
      </div>
      {node.kind === 'folder' && isOpen && ws.draft?.folder === node.path && (
        <DraftRow draft={ws.draft} depth={depth + 1} />
      )}
      {node.kind === 'folder' &&
        isOpen &&
        node.children.map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggle={onToggle}
            onMenu={onMenu}
          />
        ))}
    </>
  )
}

/** A new note or folder being named. It's created when you press Enter; Esc or clicking away drops it. */
function DraftRow({ draft, depth }: { draft: Draft; depth: number }) {
  const ws = useWorkspace()
  return (
    <div
      className={`tree-row draft ${draft.kind === 'note' ? 'file' : 'folder'}`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      <span className="chevron-spacer" />
      {draft.kind === 'note' ? <FileIcon className="draft-icon" /> : <FolderIcon className="draft-icon" />}
      <NameInput
        initial=""
        placeholder={draft.kind === 'note' ? 'Note name' : 'Folder name'}
        commitOnBlur={false}
        onDone={async (value) => {
          if (value === null || !value.trim()) {
            ws.cancelDraft()
            return null
          }
          return ws.commitDraft(value)
        }}
      />
    </div>
  )
}

/**
 * A name box in the file list. Enter confirms and Esc cancels. Clicking away confirms a rename (it changes
 * something that already exists) but cancels a new note or folder, so nothing is created by accident.
 * `onDone` returns a message if the name can't be used, and the box stays open to fix it.
 */
function NameInput({
  initial,
  placeholder,
  commitOnBlur,
  onDone
}: {
  initial: string
  placeholder?: string
  commitOnBlur: boolean
  onDone(value: string | null): Promise<string | null>
}) {
  const ref = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [error, setError] = useState<string | null>(null)

  const finish = async (value: string | null): Promise<void> => {
    if (busy.current) return
    busy.current = true
    const problem = await onDone(value === null ? null : value.trim())
    busy.current = false
    if (problem) {
      setError(problem)
      ref.current?.focus()
    }
  }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <span className="name-input">
      <input
        ref={ref}
        className="rename-input"
        defaultValue={initial}
        placeholder={placeholder}
        aria-invalid={!!error}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        onChange={() => setError(null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void finish(e.currentTarget.value)
          if (e.key === 'Escape') void finish(null)
        }}
        onBlur={(e) => {
          if (busy.current) return
          void finish(commitOnBlur ? e.currentTarget.value : null)
        }}
      />
      {error && <span className="name-error">{error}</span>}
    </span>
  )
}
