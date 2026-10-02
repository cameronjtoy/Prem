import { useEffect, useMemo, useRef, useState } from 'react'
import { COMMANDS, formatKey, type Command } from '@shared/commands'
import { noteTitle } from '@shared/vault/paths'
import { canRun, currentBindings, isMac, runCommand } from '../commands/registry'
import { useVault } from '../state/VaultContext'
import { useWorkspace } from '../state/WorkspaceContext'

interface Item {
  id: string
  label: string
  detail?: string
  /** Shown on the right, e.g. a shortcut. */
  aside?: string
}

/** Every word of the query must appear; items whose label starts with it, then whose words do, come first. */
export function rank(items: Item[], query: string): Item[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return items
  const scored: { item: Item; score: number }[] = []
  for (const item of items) {
    const label = item.label.toLowerCase()
    const hay = `${label} ${(item.detail ?? '').toLowerCase()}`
    if (!words.every((w) => hay.includes(w))) continue
    const first = words[0]
    const score = label.startsWith(first)
      ? 0
      : new RegExp(`\\b${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(label)
        ? 1
        : 2
    scored.push({ item, score: score * 1000 + label.length })
  }
  return scored.sort((a, b) => a.score - b.score).map((s) => s.item)
}

function PaletteList({
  label,
  placeholder,
  items,
  empty,
  onPick,
  onClose
}: {
  label: string
  placeholder: string
  items: Item[]
  empty: string
  onPick(item: Item): void
  onClose(): void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLUListElement>(null)
  const shown = useMemo(() => rank(items, query).slice(0, 200), [items, query])

  useEffect(() => setSelected(0), [query])
  useEffect(() => {
    listRef.current?.children[selected]?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const pick = (item: Item | undefined): void => {
    if (!item) return
    onClose()
    onPick(item)
  }

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal search-modal palette"
        role="dialog"
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => Math.min(s + 1, shown.length - 1))
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => Math.max(s - 1, 0))
          } else if (e.key === 'Enter') pick(shown[selected])
        }}
      >
        <input
          autoFocus
          className="text-input search-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        {shown.length === 0 && <p className="empty">{empty}</p>}
        <ul className="search-results" ref={listRef} role="listbox">
          {shown.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : undefined}
              onMouseEnter={() => setSelected(i)}
              onClick={() => pick(item)}
            >
              <div className="search-title">
                <span>{item.label}</span>
                {item.detail && <span className="search-path">{item.detail}</span>}
                {item.aside && <kbd className="palette-key">{item.aside}</kbd>}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function shortcutFor(id: string): string | undefined {
  const binding = currentBindings().get(id)
  return binding ? formatKey(binding, isMac) : undefined
}

/** ⌘⇧P: every command that can run right now, with its shortcut. */
export function CommandPalette({ onClose }: { onClose(): void }) {
  const items = useMemo<Item[]>(
    () =>
      (COMMANDS as readonly Command[])
        .filter((c) => c.id !== 'app.commandPalette' && canRun(c.id))
        .map((c) => ({ id: c.id, label: c.title, detail: c.category, aside: shortcutFor(c.id) })),
    []
  )
  return (
    <PaletteList
      label="Command palette"
      placeholder="Type a command…"
      items={items}
      empty="No command matches."
      // Let the palette close first, so the command acts on the note rather than the palette.
      onPick={(item) => setTimeout(() => runCommand(item.id, 'palette'))}
      onClose={onClose}
    />
  )
}

/** ⌘E: jump to any note by name. */
export function QuickSwitcher({ onClose }: { onClose(): void }) {
  const { entries } = useVault()
  const { openNote } = useWorkspace()
  const items = useMemo<Item[]>(
    () =>
      entries
        .filter((e) => e.kind === 'file' && /\.md$/i.test(e.path) && !e.path.startsWith('templates/'))
        .map((e) => ({ id: e.path, label: noteTitle(e.path), detail: e.path.replace(/\/?[^/]+$/, '') || 'vault' })),
    [entries]
  )
  return (
    <PaletteList
      label="Go to note"
      placeholder="Go to note…"
      items={items}
      empty="No note matches."
      onPick={(item) => openNote(item.id)}
      onClose={onClose}
    />
  )
}

/** ⌘/: every shortcut, grouped. */
export function ShortcutsSheet({ onClose }: { onClose(): void }) {
  const groups = new Map<string, Command[]>()
  for (const c of COMMANDS as readonly Command[]) {
    if (!currentBindings().has(c.id)) continue
    groups.set(c.category, [...(groups.get(c.category) ?? []), c])
  }
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal shortcuts-modal"
        role="dialog"
        aria-label="Keyboard shortcuts"
        tabIndex={-1}
        ref={(el) => el?.focus()}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div className="shortcuts-head">
          <h2>Keyboard shortcuts</h2>
          <span className="hint">
            {shortcutFor('app.commandPalette')} lists every command, including those without a shortcut.
          </span>
        </div>
        <div className="shortcuts-grid">
          {[...groups].map(([category, commands]) => (
            <section key={category}>
              <h3>{category}</h3>
              <dl>
                {commands.map((c) => (
                  <div key={c.id} className="shortcut-row">
                    <dt>{c.title}</dt>
                    <dd>
                      <kbd className="palette-key">{shortcutFor(c.id)}</kbd>
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
