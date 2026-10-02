import { useEffect, useState } from 'react'
import { Group, Panel, Separator, usePanelRef } from 'react-resizable-panels'
import { notebookFolder } from '@shared/notes/notebook'
import { BacklinksPanel } from './components/Backlinks/BacklinksPanel'
import { NoteEditor } from './components/Editor/NoteEditor'
import { FileTree } from './components/FileTree/FileTree'
import { GraphView } from './components/Graph/GraphView'
import { EditIcon, GraphIcon, SearchIcon, TemplateIcon, TodayIcon, VaultIcon } from './components/icons'
import { CommandPalette, QuickSwitcher, ShortcutsSheet } from './components/Palette'
import { SearchPalette } from './components/SearchPalette'
import { handleKeyDown, keyFor, runCommand, useCommand } from './commands/registry'
import { vaultClient } from './services/vaultClient'
import { TemplatePicker } from './components/TemplatePicker'
import { WelcomeScreen } from './components/WelcomeScreen'
import { LinkIndexProvider } from './state/LinkIndexContext'
import { useVault, VaultProvider } from './state/VaultContext'
import { useWorkspace, WorkspaceProvider } from './state/WorkspaceContext'

const WEBSITE = 'https://cameronjtoy.github.io/Prem/'
const ISSUES = 'https://github.com/cameronjtoy/Prem/issues/new/choose'

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
  const [overlay, setOverlay] = useState<'search' | 'commands' | 'notes' | 'shortcuts' | null>(null)
  const filesPanel = usePanelRef()
  const linksPanel = usePanelRef()
  const vaultOpen = (): boolean => !!info
  const toggle = (which: NonNullable<typeof overlay>) => () => setOverlay((open) => (open === which ? null : which))
  const togglePanel = (ref: typeof filesPanel) => () => {
    const panel = ref.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  useCommand('app.commandPalette', toggle('commands'), vaultOpen)
  useCommand('app.shortcuts', toggle('shortcuts'))
  useCommand('app.search', toggle('search'), vaultOpen)
  useCommand('app.quickSwitcher', toggle('notes'), vaultOpen)
  useCommand('nav.back', ws.goBack, ws.canGoBack)
  useCommand('nav.forward', ws.goForward, ws.canGoForward)
  useCommand(
    'note.today',
    () => void ws.openToday(),
    () => vaultOpen() && canKeepNotebook
  )
  useCommand(
    'note.new',
    () => void ws.createNote(ws.currentFolder()),
    () => vaultOpen() && canCreate
  )
  useCommand(
    'note.newFromTemplate',
    () => ws.showTemplatePicker(ws.currentFolder()),
    () => vaultOpen() && canCreate
  )
  useCommand(
    'note.exportPdf',
    () => ws.active && void ws.exportPdf(ws.active.path),
    () => !!ws.active
  )
  useCommand('vault.open', () => void openVault())
  useCommand('view.graph', () => ws.setView(ws.view === 'graph' ? 'editor' : 'graph'), vaultOpen)
  useCommand('view.toggleFiles', togglePanel(filesPanel), vaultOpen)
  useCommand('view.toggleLinks', togglePanel(linksPanel), vaultOpen)
  useCommand(
    'note.reveal',
    () => {
      filesPanel.current?.expand()
      const path = ws.active?.path
      // The tree expands the note's folders when it opens; wait a frame for the row to exist.
      requestAnimationFrame(() => {
        const row = path && document.querySelector<HTMLElement>(`.file-tree [title="${CSS.escape(path)}"]`)
        if (!row) return
        row.scrollIntoView({ block: 'nearest' })
        row.classList.add('flash')
        setTimeout(() => row.classList.remove('flash'), 900)
      })
    },
    () => !!ws.active
  )
  useCommand('help.website', () => void vaultClient.openExternal(WEBSITE))
  useCommand('help.reportIssue', () => void vaultClient.openExternal(ISSUES))

  useEffect(() => {
    // Capture phase, so these win over the editor's own keys (e.g. ⌘[ "indent less") when they can run.
    window.addEventListener('keydown', handleKeyDown, true)
    const offMenu = window.api.app.onCommand((id) => runCommand(id, 'menu'))
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      offMenu()
    }
  }, [])

  if (!info) return <WelcomeScreen />

  return (
    <div className="app">
      <Group orientation="horizontal" className="panels">
        <Panel defaultSize="20%" minSize="160px" maxSize="45%" collapsible collapsedSize={0} panelRef={filesPanel}>
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
                  title={`Graph view (${keyFor('view.graph')})`}
                >
                  <GraphIcon /> Graph
                </button>
              </div>
              <div className="toolbar-spacer" />
              <button
                className="text-button"
                onClick={() => setOverlay('search')}
                title={`Search all notes (${keyFor('app.search')})`}
              >
                <SearchIcon /> Search
              </button>
              {canKeepNotebook && (
                <button
                  className="text-button"
                  onClick={() => void ws.openToday()}
                  title={`Today's notebook entry (${keyFor('note.today')})`}
                >
                  <TodayIcon /> Today
                </button>
              )}
              {canCreate && (
                <button className="text-button" onClick={() => ws.showTemplatePicker(ws.currentFolder())}>
                  <TemplateIcon /> New from template
                </button>
              )}
              <button
                className="text-button"
                onClick={() => void openVault()}
                title={`Open another vault (${keyFor('vault.open')})`}
              >
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
        <Panel defaultSize="22%" minSize="180px" maxSize="40%" collapsible collapsedSize={0} panelRef={linksPanel}>
          <BacklinksPanel />
        </Panel>
      </Group>
      {ws.templatePickerFolder !== null && <TemplatePicker folder={ws.templatePickerFolder} />}
      {overlay === 'search' && <SearchPalette onClose={() => setOverlay(null)} />}
      {overlay === 'commands' && <CommandPalette onClose={() => setOverlay(null)} />}
      {overlay === 'notes' && <QuickSwitcher onClose={() => setOverlay(null)} />}
      {overlay === 'shortcuts' && <ShortcutsSheet onClose={() => setOverlay(null)} />}
    </div>
  )
}

function EmptyState() {
  const ws = useWorkspace()
  const { info, canWrite } = useVault()
  const notebook = notebookFolder(info?.user)
  const canKeepNotebook = canWrite(notebook)
  const canWriteProtocols = canWrite('Protocols')
  if (!canKeepNotebook && !canWriteProtocols) {
    return (
      <div className="empty-state">
        <p>No note open.</p>
        <p className="hint">
          Pick a note from the list on the left. {keyFor('app.search')} searches everything you can read.
        </p>
      </div>
    )
  }
  return (
    <div className="empty-state">
      <p className="empty-title">What are you working on?</p>
      <div className="empty-actions">
        {canKeepNotebook && (
          <button className="primary-button" onClick={() => void ws.openToday()}>
            Today&apos;s entry <kbd>{keyFor('note.today')}</kbd>
          </button>
        )}
        {canKeepNotebook && (
          <button className="text-button" onClick={() => ws.showTemplatePicker(notebook)}>
            New experiment or note
          </button>
        )}
        {canWriteProtocols && (
          <button className="text-button" onClick={() => ws.showTemplatePicker('Protocols')}>
            Write a protocol
          </button>
        )}
      </div>
      <p className="hint">
        Open a protocol and choose Start run to record a run step by step. {keyFor('app.commandPalette')} lists every
        command; {keyFor('app.search')} searches; {keyFor('view.graph')} shows how notes link.
      </p>
    </div>
  )
}
