import { useEffect, useRef, useState } from 'react'
import { SETTINGS, type SettingDef, type SettingKey, type SettingSection } from '@shared/settings/schema'
import { keyFor } from '../../commands/registry'
import { errorMessage } from '../../services/vaultClient'
import { useKeybindings } from '../../state/KeybindingsContext'
import { useSettings } from '../../state/SettingsContext'
import { ShortcutsTab } from './ShortcutsTab'

const SECTIONS: SettingSection[] = ['Appearance', 'Editor', 'Notebook', 'Export']
const ALL = SETTINGS as readonly SettingDef[]

function matchesQuery(def: SettingDef, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [def.key, def.title, def.description, def.section].some((t) => t.toLowerCase().includes(q))
}

export type SettingsTab = 'settings' | 'keybindings'

/** Settings and keyboard shortcuts, each searchable. Changes are saved to settings.json or keybindings.json straight away. */
export function SettingsView({
  tab,
  onTab,
  onClose
}: {
  tab: SettingsTab
  onTab(tab: SettingsTab): void
  onClose(): void
}) {
  const settings = useSettings()
  const keys = useKeybindings()
  const [query, setQuery] = useState('')
  const [fileError, setFileError] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const fileName = tab === 'settings' ? 'settings.json' : 'keybindings.json'
  const snapshot = tab === 'settings' ? settings.snapshot : keys.snapshot

  // On the window, so Esc works wherever focus is, e.g. after the shortcut recorder closes. Boxes that use
  // Esc themselves (the recorder, a half-typed value) stop it first.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    setQuery('')
    setFileError(null)
    searchRef.current?.focus()
  }, [tab])

  const open = (): void => {
    setFileError(null)
    const opening = tab === 'settings' ? settings.openFile() : keys.openFile()
    opening.catch((e) => setFileError(errorMessage(e)))
  }

  return (
    <div className="settings-page" role="dialog" aria-label="Settings">
      <header className="settings-header">
        <h1>Settings</h1>
        <div className="segmented" role="tablist">
          <button
            role="tab"
            aria-selected={tab === 'settings'}
            className={tab === 'settings' ? 'on' : undefined}
            onClick={() => onTab('settings')}
          >
            General
          </button>
          <button
            role="tab"
            aria-selected={tab === 'keybindings'}
            className={tab === 'keybindings' ? 'on' : undefined}
            onClick={() => onTab('keybindings')}
          >
            Keyboard shortcuts
          </button>
        </div>
        <div className="toolbar-spacer" />
        <input
          ref={searchRef}
          className="settings-search"
          type="search"
          placeholder={tab === 'settings' ? 'Search settings' : 'Search commands and shortcuts'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="text-button" onClick={open} title={snapshot.file}>
          Open {fileName}
        </button>
        <button className="text-button" onClick={onClose} title={`Close (Esc or ${keyFor('app.settings')})`}>
          Done
        </button>
      </header>

      {snapshot.error && (
        <div className="banner error settings-banner" role="alert">
          <span>
            {fileName} has a mistake at {snapshot.error}. Prem is using your last good{' '}
            {tab === 'settings' ? 'settings' : 'shortcuts'} until it&apos;s fixed.
          </span>
          <button onClick={open}>Open {fileName}</button>
        </div>
      )}
      {snapshot.problems.length > 0 && (
        <div className="banner warning settings-banner" role="alert">
          <span>
            Some entries in {fileName} were ignored
            {tab === 'settings' ? ', and their defaults are used instead' : ''}:
            <ul>
              {snapshot.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </span>
        </div>
      )}
      {fileError && (
        <div className="banner error settings-banner">
          <span>{fileError}</span>
        </div>
      )}

      <div className="settings-body">
        {tab === 'settings' ? <GeneralTab query={query} /> : <ShortcutsTab query={query} />}
      </div>
    </div>
  )
}

function GeneralTab({ query }: { query: string }) {
  const visible = ALL.filter((d) => matchesQuery(d, query))
  return (
    <>
      {SECTIONS.map((section) => {
        const defs = visible.filter((d) => d.section === section)
        if (!defs.length) return null
        return (
          <section key={section} className="settings-section">
            <h2>{section}</h2>
            {defs.map((def) => (
              <SettingRow key={def.key} def={def} />
            ))}
          </section>
        )
      })}
      {!visible.length && <p className="settings-empty">No settings match “{query}”.</p>}
      <p className="settings-footnote">
        Settings are saved in <code>settings.json</code>, which lists only what you&apos;ve changed. Edit it in any text
        editor and Prem picks up the change when you save.
      </p>
    </>
  )
}

function SettingRow({ def }: { def: SettingDef }) {
  const { values, set } = useSettings()
  const value = values[def.key as SettingKey]
  const modified = value !== def.default
  const [error, setError] = useState<string | null>(null)
  const id = `setting-${def.key}`

  const save = (next: unknown): void => {
    setError(null)
    set(def.key as SettingKey, next).catch((e) => setError(errorMessage(e)))
  }

  return (
    <div className={`setting-row${modified ? ' modified' : ''}`} data-setting={def.key}>
      <div className="setting-text">
        <label htmlFor={id} className="setting-title">
          {def.title}
          {modified && (
            <span className="setting-modified" title="Changed from the default">
              Modified
            </span>
          )}
        </label>
        <p className="setting-description">{def.description}</p>
        <code className="setting-key">{def.key}</code>
        {error && <p className="setting-error">{error}</p>}
      </div>
      <div className="setting-control">
        <Control id={id} def={def} value={value} onSave={save} />
        {modified && (
          <button
            className="text-button setting-reset"
            onClick={() => save(def.default)}
            title={`Back to ${String(def.default)}`}
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

function Control({
  id,
  def,
  value,
  onSave
}: {
  id: string
  def: SettingDef
  value: unknown
  onSave(value: unknown): void
}) {
  switch (def.type) {
    case 'boolean':
      return (
        <input
          id={id}
          type="checkbox"
          className="switch"
          checked={value === true}
          onChange={(e) => onSave(e.target.checked)}
        />
      )
    case 'enum':
      return (
        <select id={id} value={String(value)} onChange={(e) => onSave(e.target.value)}>
          {def.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )
    case 'number':
      return (
        <TextControl
          id={id}
          type="number"
          value={String(value)}
          attrs={{ min: def.min, max: def.max, step: def.step ?? 1 }}
          suffix={def.unit}
          onSave={(text) => onSave(text.trim() === '' ? NaN : Number(text))}
        />
      )
    case 'string':
      return <TextControl id={id} type="text" value={String(value)} onSave={onSave} />
  }
}

/** A text or number box that saves when you press Enter or leave it, not on every keystroke. */
function TextControl({
  id,
  type,
  value,
  attrs,
  suffix,
  onSave
}: {
  id: string
  type: 'text' | 'number'
  value: string
  attrs?: Record<string, number>
  suffix?: string
  onSave(text: string): void
}) {
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const commit = (): void => {
    if (draft !== value) onSave(draft)
  }
  return (
    <span className="setting-input">
      <input
        id={id}
        type={type}
        value={draft}
        {...attrs}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape' && draft !== value) {
            e.preventDefault()
            e.stopPropagation()
            setDraft(value)
          }
        }}
      />
      {suffix && <span className="setting-unit">{suffix}</span>}
    </span>
  )
}
