import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { commandById, formatKey, type Category, type Command, type KeyBinding } from '@shared/commands'
import { ALL_COMMANDS, bindingFromEvent, conflictsWith, isCustomized, keyText } from '@shared/keybindings'
import { currentBindings, isMac } from '../../commands/registry'
import { errorMessage } from '../../services/vaultClient'
import { useKeybindings } from '../../state/KeybindingsContext'

const CATEGORIES: Category[] = ['General', 'Navigate', 'Note', 'Format', 'Run', 'Analysis', 'View']
const MODIFIER_CODES = /^(Shift|Control|Alt|Meta|OS)(Left|Right)?$/

function matchesQuery(c: Command, key: string, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [c.title, c.id, c.category, key].some((t) => t.toLowerCase().includes(q))
}

/** Every command and its shortcut. Change one by pressing the new keys; it's saved to keybindings.json. */
export function ShortcutsTab({ query }: { query: string }) {
  const bindings = currentBindings()
  const shown = ALL_COMMANDS.map((c) => {
    const binding = bindings.get(c.id)
    return { command: c, key: binding ? formatKey(binding, isMac) : '' }
  }).filter(({ command, key }) => matchesQuery(command, key, query))

  return (
    <>
      {CATEGORIES.map((category) => {
        const rows = shown.filter((r) => r.command.category === category)
        if (!rows.length) return null
        return (
          <section key={category} className="settings-section">
            <h2>{category}</h2>
            {rows.map(({ command }) => (
              <ShortcutRow key={command.id} command={command} />
            ))}
          </section>
        )
      })}
      {!shown.length && <p className="settings-empty">No commands match “{query}”.</p>}
      <p className="settings-footnote">
        Changes are saved in <code>keybindings.json</code>, which lists only the shortcuts you changed, e.g.{' '}
        <code>{'{ "key": "Mod+Shift+L", "command": "format.link" }'}</code>. <code>Mod</code> is ⌘ on macOS and Ctrl
        elsewhere, and <code>{'{ "command": "-note.today" }'}</code> takes a shortcut away.
      </p>
    </>
  )
}

type Pending = { binding: KeyBinding; others: string[] }

function ShortcutRow({ command }: { command: Command }) {
  const keys = useKeybindings()
  const binding = currentBindings().get(command.id)
  const modified = isCustomized(keys.snapshot.entries, command.id)
  const [recording, setRecording] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const recorderRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (recording) recorderRef.current?.focus()
  }, [recording])

  const run = (work: () => Promise<void>): void => {
    setError(null)
    work().catch((e) => setError(errorMessage(e)))
  }

  const stop = (): void => {
    setRecording(false)
    setHint(null)
  }

  const save = (next: KeyBinding, replace: string[]): void =>
    run(async () => {
      await keys.set(command.id, keyText(next))
      for (const other of replace) await keys.set(other, null)
      setPending(null)
    })

  const onRecordKey = (e: KeyboardEvent<HTMLSpanElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    if (e.key === 'Escape') return stop()
    if (MODIFIER_CODES.test(e.code)) return
    const next = bindingFromEvent(e.nativeEvent, isMac)
    if (!next) {
      setHint(`Use ${isMac ? '⌘ or ⌥' : 'Ctrl or Alt'} with a key, or a function key.`)
      return
    }
    stop()
    const others = conflictsWith(currentBindings(), command.id, next)
    if (others.length) setPending({ binding: next, others })
    else save(next, [])
  }

  return (
    <div className={`setting-row shortcut-edit-row${modified ? ' modified' : ''}`} data-command={command.id}>
      <div className="setting-text">
        <span className="setting-title">
          {command.title}
          {modified && (
            <span className="setting-modified" title="Changed from the default">
              Modified
            </span>
          )}
        </span>
        <code className="setting-key">{command.id}</code>
        {pending && (
          <div className="shortcut-conflict" role="alert">
            <span>
              <kbd>{formatKey(pending.binding, isMac)}</kbd> is also used by{' '}
              {pending.others.map((id) => commandById(id)?.title ?? id).join(', ')}.
            </span>
            <button onClick={() => save(pending.binding, pending.others)}>Replace</button>
            <button onClick={() => save(pending.binding, [])} title="Both keep it; whichever can run at the time does">
              Keep both
            </button>
            <button onClick={() => setPending(null)}>Cancel</button>
          </div>
        )}
        {error && <p className="setting-error">{error}</p>}
      </div>
      <div className="setting-control shortcut-control">
        {recording ? (
          <span
            ref={recorderRef}
            className="key-recorder"
            tabIndex={0}
            data-recording
            role="textbox"
            aria-label={`New shortcut for ${command.title}`}
            onKeyDown={onRecordKey}
            onBlur={stop}
          >
            {hint ?? 'Press the new shortcut…'}
          </span>
        ) : (
          <kbd className={binding ? 'shortcut-key' : 'shortcut-key none'}>
            {binding ? formatKey(binding, isMac) : 'None'}
          </kbd>
        )}
        <div className="shortcut-actions">
          {!recording && (
            <button
              className="text-button"
              onClick={() => {
                setPending(null)
                setRecording(true)
              }}
            >
              Change
            </button>
          )}
          {binding && !recording && (
            <button className="text-button" onClick={() => run(() => keys.set(command.id, null))}>
              Remove
            </button>
          )}
          {modified && !recording && (
            <button className="text-button" onClick={() => run(() => keys.reset(command.id))}>
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
