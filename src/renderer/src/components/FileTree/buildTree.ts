import { basename, dirname } from '@shared/paths'
import type { EntryKind, VaultEntry, VaultPath } from '@shared/types'

export interface TreeNode {
  path: VaultPath
  name: string
  kind: EntryKind
  children: TreeNode[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildTree(entries: VaultEntry[]): TreeNode[] {
  const nodes = new Map<VaultPath, TreeNode>()
  const roots: TreeNode[] = []
  const sorted = [...entries].sort((a, b) => a.path.length - b.path.length)
  for (const e of sorted) {
    const name = e.kind === 'file' ? basename(e.path).replace(/\.md$/i, '') : basename(e.path)
    const node: TreeNode = { path: e.path, name, kind: e.kind, children: [] }
    nodes.set(e.path, node)
    const parent = nodes.get(dirname(e.path))
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sort = (list: TreeNode[]): void => {
    list.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'folder' ? -1 : 1) : collator.compare(a.name, b.name)))
    for (const n of list) sort(n.children)
  }
  sort(roots)
  return roots
}
