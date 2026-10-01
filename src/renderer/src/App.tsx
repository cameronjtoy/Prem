import { useEffect, useState } from 'react'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { notebookFolder } from '@shared/notes/notebook'
import { BacklinksPanel } from './components/Backlinks/BacklinksPanel'
import { NoteEditor } from './components/Editor/NoteEditor'
import { FileTree } from './components/FileTree/FileTree'
import { GraphView } from './components/Graph/GraphView'
import { EditIcon, GraphIcon, SearchIcon, TemplateIcon, TodayIcon, VaultIcon } from './components/icons'
import { SearchPalette } from './components/SearchPalette'
import { TemplatePicker } from './components/TemplatePicker'
import { WelcomeScreen } from './components/WelcomeScreen'
import { LinkIndexProvider } from './state/LinkIndexContext'
import { useVault, VaultProvider } from './state/VaultContext'
import { useWorkspace, WorkspaceProvider } from './state/WorkspaceContext'

export function App() {
  return (
    <VaultProvider>
      <LinkIndexProvider>
        <WorkspaceProvider>
          <Shell />
        </WorkspaceProvider>
      </LinkIndexProvider>
    </VaultProvider>
  )
}

function Shell() {
  const { info, openVault, canWrite } = useVault()
  const ws = useWorkspace()
  const canCreate = canWrite(ws.currentFolder())
  const canKeepNotebook = canWrite(notebookFolder(info?.user))
  const [searching, setSearching] = useState(false)

  useEffect(() => {
    if (!info) return
    // Capture phase, so these win over the editor's own shortcuts (e.g. Cmd+G "find next").
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return
      const key = e.key.toLowerCase()
      let handled = true
      if (key === 'n' && e.shiftKey) {
        if (canCreate) ws.showTemplatePicker(ws.currentFolder())
      } else if (key === 'n') {
        if (canCreate) void ws.createNote(ws.currentFolder())
      } else if (key === 'k' && !e.shiftKey) setSearching((open) => !open)
      else if (key === 't' && !e.shiftKey) {
        if (canKeepNotebook) void ws.openToday()
      } else if (key === 'g' && !e.shiftKey) ws.setView(ws.view === 'graph' ? 'editor' : 'graph')
      else if (key === 'o' && !e.shiftKey) void openVault()
      else if (key === 'p' && !e.shiftKey) {
        if (ws.active) void ws.exportPdf(ws.active.path)
      } else handled = false
      if (handled) {
        e.preventDefault()
        e.stopPropagation()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [info, ws, openVault, canCreate, canKeepNotebook])

  if (!info) return <WelcomeScreen />

  return (
    <div className="app">
      <Group orientation="horizontal" className="panels">
        <Panel defaultSize="20%" minSize="160px" maxSize="45%">
          <FileTree />
        </Panel>
        <Separator className="resize-handle" />
        <Panel minSize="30%">
          <main className="main-pane">
            <div className="main-toolbar">
              <div className="segmented" role="tablist">
                <button
                  role="tab"
                  aria-selected={ws.view === 'editor'}
                  className={ws.view === 'editor' ? 'on' : undefined}
                  onClick={() => ws.setView('editor')}
                >
                  <EditIcon /> Note
                </button>
                <button
                  role="tab"
                  aria-selected={ws.view === 'graph'}
                  className={ws.view === 'graph' ? 'on' : undefined}
                  onClick={() => ws.setView('graph')}
                  title="Graph view (⌘G)"
                >
                  <GraphIcon /> Graph
                </button>
              </div>
              <div className="toolbar-spacer" />
              <button className="text-button" onClick={() => setSearching(true)} title="Search all notes (⌘K)">
                <SearchIcon /> Search
              </button>
              {canKeepNotebook && (
                <button className="text-button" onClick={() => void ws.openToday()} title="Today's notebook entry (⌘T)">
                  <TodayIcon /> Today
                </button>
              )}
              {canCreate && (
                <button className="text-button" onClick={() => ws.showTemplatePicker(ws.currentFolder())}>
                  <TemplateIcon /> New from template
                </button>
              )}
              <button className="text-button" onClick={() => void openVault()} title="Open another vault (⌘O)">
                <VaultIcon /> Switch vault
              </button>
            </div>
            {ws.notice && (
              <div className={`banner ${ws.noticeKind}`}>
                <span>{ws.notice}</span>
                <button onClick={() => ws.showNotice(null)}>Dismiss</button>
              </div>
            )}
            <div className="main-content">
              {ws.view === 'graph' ? (
                <GraphView />
              ) : ws.active ? (
                <NoteEditor key={ws.active.path} path={ws.active.path} cursor={ws.active.cursor} />
              ) : (
                <EmptyState />
              )}
            </div>
          </main>
        </Panel>
        <Separator className="resize-handle" />
        <Panel defaultSize="22%" minSize="180px" maxSize="40%">
          <BacklinksPanel />
        </Panel>
      </Group>
      {ws.templatePickerFolder !== null && <TemplatePicker folder={ws.templatePickerFolder} />}
      {searching && <SearchPalette onClose={() => setSearching(false)} />}
    </div>
  )
}

function EmptyState() {
  const ws = useWorkspace()
  const { canWrite } = useVault()
  if (!canWrite('')) {
    return (
      <div className="empty-state">
        <p>No note open.</p>
        <p className="hint">Pick a note from the list on the left. ⌘G shows the graph.</p>
      </div>
    )
  }
  return (
    <div className="empty-state">
      <p>No note open.</p>
      <div className="empty-actions">
        <button className="primary-button" onClick={() => void ws.createNote('')}>
          New note
        </button>
        <button className="text-button" onClick={() => ws.showTemplatePicker('')}>
          New from template
        </button>
      </div>
      <p className="hint">⌘K search · ⌘T today · ⌘N new note · ⌘⇧N from template · ⌘G graph · ⌘S save</p>
    </div>
  )
}
