import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { dirname, isMarkdown } from '@shared/vault/paths'
import { useVault } from '../../state/VaultContext'
import { useWorkspace } from '../../state/WorkspaceContext'
import { ContextMenu, type MenuItem, type MenuState } from '../ContextMenu'
import { ChevronIcon, CollapseIcon, NewFolderIcon, NewNoteIcon, TemplateIcon } from '../icons'
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

export function FileTree() {
  const { info, entries, canWrite } = useVault()
  const ws = useWorkspace()
  const canCreate = canWrite(ws.currentFolder())
  const tree = useMemo(() => buildTree(entries), [entries])
  const storageKey = `expanded:${info?.root ?? ''}`
  const [expanded, setExpanded] = useState(() => loadExpanded(storageKey))
  const [menu, setMenu] = useState<MenuState | null>(null)

  useEffect(() => setExpanded(loadExpanded(storageKey)), [storageKey])
  useEffect(() => saveExpanded(storageKey, expanded), [storageKey, expanded])

  // Reveal the open note and anything being renamed.
  const revealPath = ws.renamingPath ?? ws.active?.path
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
      </div>
      <div className="tree-scroll" onContextMenu={(e) => openMenu(e, null)} role="tree">
        {tree.length === 0 && <p className="empty">This vault is empty. Create a note to get started.</p>}
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
          <RenameInput
            initial={node.name}
            onDone={(value) => (value === null ? ws.startRename(null) : void ws.rename(node.path, value))}
          />
        ) : (
          <span className="tree-label">{node.name}</span>
        )}
      </div>
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

function RenameInput({ initial, onDone }: { initial: string; onDone(value: string | null): void }) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const finish = (value: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(value && value.trim() && value.trim() !== initial ? value.trim() : null)
  }

  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  return (
    <input
      ref={ref}
      className="rename-input"
      defaultValue={initial}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(e.currentTarget.value)
        if (e.key === 'Escape') finish(null)
      }}
      onBlur={(e) => finish(e.currentTarget.value)}
    />
  )
}
