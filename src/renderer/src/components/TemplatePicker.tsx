import { useEffect, useState } from 'react'
import type { TemplateInfo } from '@shared/vault/types'
import { errorMessage, vaultClient } from '../services/vaultClient'
import { useWorkspace } from '../state/WorkspaceContext'

export function TemplatePicker({ folder }: { folder: string }) {
  const { createFromTemplate, showTemplatePicker } = useWorkspace()
  const [templates, setTemplates] = useState<TemplateInfo[] | null>(null)
  const [selected, setSelected] = useState(0)
  const [title, setTitle] = useState('')
  const [error, setError] = useState<string | null>(null)
  const close = (): void => showTemplatePicker(null)

  useEffect(() => {
    vaultClient
      .listTemplates()
      .then(setTemplates)
      .catch((err) => setError(errorMessage(err)))
  }, [])

  // Takes the index rather than reading `selected`, which may not have re-rendered yet after a quick click.
  const submit = (index = selected): void => {
    const template = templates?.[index]
    if (!template) return
    close()
    void createFromTemplate(template.path, title.trim() || template.name, folder)
  }

  return (
    <div className="modal-backdrop" onMouseDown={close}>
      <div
        className="modal"
        role="dialog"
        aria-label="New note from template"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close()
          if (e.key === 'ArrowDown') {
            e.preventDefault()
            setSelected((s) => Math.min(s + 1, (templates?.length ?? 1) - 1))
          }
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            setSelected((s) => Math.max(s - 1, 0))
          }
          if (e.key === 'Enter') submit()
        }}
      >
        <h2>New note from template</h2>
        <input
          autoFocus
          className="text-input"
          placeholder="Note title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        {error && <p className="error-text">{error}</p>}
        {templates && templates.length === 0 && (
          <p className="empty">No templates yet. Add markdown files to the "templates" folder in your vault.</p>
        )}
        <ul className="template-list" role="listbox">
          {templates?.map((t, i) => (
            <li
              key={t.path}
              role="option"
              aria-selected={i === selected}
              className={i === selected ? 'selected' : undefined}
              onMouseEnter={() => setSelected(i)}
              onClick={() => submit(i)}
            >
              {t.name}
            </li>
          ))}
        </ul>
        <p className="hint">
          {folder ? `Creates the note in "${folder}". ` : 'Creates the note at the top of the vault. '}
          ↑↓ to choose, Enter to create, Esc to cancel.
        </p>
      </div>
    </div>
  )
}
