import { useCallback, useEffect, useState } from 'react'
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from 'react-resizable-panels'
import { BacklinksPanel } from './components/Backlinks/BacklinksPanel'
import { NoteEditor } from './components/Editor/NoteEditor'
import { FileTree } from './components/FileTree/FileTree'
import { GraphView } from './components/Graph/GraphView'
import { ReportProblem } from './components/ReportProblem'
import { BoardView } from './components/Board/BoardView'
import { SamplesView } from './components/Samples/SamplesView'
import { MyTasks, useMyTasks } from './components/Board/MyTasks'
import {
  EditIcon,
  GraphIcon,
  BoardIcon,
  SampleIcon,
  TasksIcon,
  SearchIcon,
  SidebarLeftIcon,
  SidebarRightIcon,
  TemplateIcon,
  TodayIcon,
  VaultIcon
} from './components/icons'
import { CommandPalette, QuickSwitcher, ShortcutsSheet } from './components/Palette'
import { SearchPalette } from './components/SearchPalette'
import { SettingsView } from './components/Settings/SettingsView'
import { handleKeyDown, keyFor, runCommand, useCommand } from './commands/registry'
import { vaultClient } from './services/vaultClient'
import { TemplatePicker } from './components/TemplatePicker'
import { WelcomeScreen } from './components/WelcomeScreen'
import { LinkIndexProvider } from './state/LinkIndexContext'
import { KeybindingsProvider, useKeybindings } from './state/KeybindingsContext'
import { SettingsProvider, useNotebookFolder, useSettings } from './state/SettingsContext'
import { useVault, VaultProvider } from './state/VaultContext'
import { useWorkspace, WorkspaceProvider } from './state/WorkspaceContext'

const WEBSITE = 'https://cameronjtoy.github.io/Prem/'

export function App() {
  return (
    <SettingsProvider>
      <KeybindingsProvider>
        <VaultProvider>
          <LinkIndexProvider>
            <WorkspaceProvider>
              <Shell />
            </WorkspaceProvider>
          </LinkIndexProvider>
        </VaultProvider>
      </KeybindingsProvider>
    </SettingsProvider>
  )
}

function Shell() {
  const { info, openVault, canWrite } = useVault()
  const ws = useWorkspace()
  const canCreate = canWrite(ws.currentFolder())
  const canKeepNotebook = canWrite(useNotebookFolder(info?.user))
  const [overlay, setOverlay] = useState<
    'search' | 'commands' | 'notes' | 'shortcuts' | 'settings' | 'keybindings' | null
  >(null)
  const { snapshot: settingsSnapshot, values: settingValues } = useSettings()
  const samplesFolder = settingValues['samples.folder']
  // Reading the shortcuts here re-renders the app when they change, so every label shows the new keys.
  const { snapshot: keysSnapshot } = useKeybindings()
  const trouble = troubleWith(settingsSnapshot, keysSnapshot)
  const settingsOpen = overlay === 'settings' || overlay === 'keybindings'
  const filesPanel = usePanelRef()
  const linksPanel = usePanelRef()
  // Panel widths, and whether each side panel is hidden, are kept between launches.
  const layout = useDefaultLayout({ id: 'prem-panels', storage: localStorage })
  // A new version downloaded in the background, ready to install on restart.
  const [update, setUpdate] = useState<string | null>(null)
  useEffect(() => window.api.app.onUpdateReady(setUpdate), [])
  const [reporting, setReporting] = useState(false)
  const [filesHidden, setFilesHidden] = useState(false)
  const [linksHidden, setLinksHidden] = useState(false)
  const [tasksOpen, setTasksOpen] = useState(false)
  const closeTasks = useCallback(() => setTasksOpen(false), [])
  const myTasks = useMyTasks()
  const vaultOpen = (): boolean => !!info
  const toggle = (which: NonNullable<typeof overlay>) => () => setOverlay((open) => (open === which ? null : which))
  const togglePanel = (ref: typeof filesPanel) => () => {
    const panel = ref.current
    if (!panel) return
    if (panel.isCollapsed()) panel.expand()
    else panel.collapse()
  }

  // Naming a new note or folder happens in the file list, so show it if it's hidden.
  useEffect(() => {
    if (ws.draft && filesPanel.current?.isCollapsed()) filesPanel.current.expand()
  }, [ws.draft, filesPanel])

  useCommand('app.commandPalette', toggle('commands'), vaultOpen)
  useCommand('app.shortcuts', toggle('shortcuts'))
  useCommand('app.settings', () =>
    setOverlay((open) => (open === 'settings' || open === 'keybindings' ? null : 'settings'))
  )
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
  useCommand('vault.backup', () => void ws.backupVault(), vaultOpen)
  useCommand('view.graph', () => ws.setView(ws.view === 'graph' ? 'editor' : 'graph'), vaultOpen)
  useCommand('view.board', () => ws.setView(ws.view === 'board' ? 'editor' : 'board'), vaultOpen)
  useCommand('view.samples', () => ws.setView(ws.view === 'samples' ? 'editor' : 'samples'), vaultOpen)
  useCommand(
    'sample.new',
    () => void ws.newSample(),
    () => vaultOpen() && canWrite(samplesFolder)
  )
  useCommand('view.myTasks', () => setTasksOpen((open) => !open), vaultOpen)
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
  useCommand('help.reportIssue', () => setReporting(true))
  useCommand('help.showLogs', () => void vaultClient.showLogs().catch(() => {}))

  useEffect(() => {
    // Capture phase, so these win over the editor's own keys (e.g. ⌘[ "indent less") when they can run.
    window.addEventListener('keydown', handleKeyDown, true)
    const offMenu = window.api.app.onCommand((id) => runCommand(id, 'menu'))
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true)
      offMenu()
    }
  }, [])

  const settings = settingsOpen && (
    <SettingsView
      tab={overlay === 'keybindings' ? 'keybindings' : 'settings'}
      onTab={(tab) => setOverlay(tab)}
      onClose={() => setOverlay(null)}
    />
  )
  const report = reporting && <ReportProblem onClose={() => setReporting(false)} />
  const sheet = overlay === 'shortcuts' && (
    <ShortcutsSheet onClose={() => setOverlay(null)} onCustomize={() => setOverlay('keybindings')} />
  )

  if (!info) {
    return (
      <>
        <WelcomeScreen />
        {settings}
        {sheet}
        {report}
      </>
    )
  }

  return (
    <div className="app">
      <Group
        orientation="horizontal"
        className="panels"
        id="prem-panels"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <Panel
          id="files"
          defaultSize="20%"
          minSize="160px"
          maxSize="45%"
          collapsible
          collapsedSize={0}
          panelRef={filesPanel}
          onResize={() => setFilesHidden(!!filesPanel.current?.isCollapsed())}
        >
          <FileTree onHide={togglePanel(filesPanel)} />
        </Panel>
        <Separator className="resize-handle" />
        <Panel id="main" minSize="30%">
          <main className="main-pane">
            <div className="main-toolbar">
              {filesHidden && (
                <button
                  className="icon-button panel-toggle"
                  onClick={togglePanel(filesPanel)}
                  title={`Show the file list (${keyFor('view.toggleFiles')})`}
                  aria-label="Show the file list"
                >
                  <SidebarLeftIcon />
                </button>
              )}
              <div className="segmented" role="tablist">
                <button
                  aria-label="Note"
                  role="tab"
                  aria-selected={ws.view === 'editor'}
                  className={ws.view === 'editor' ? 'on' : undefined}
                  onClick={() => ws.setView('editor')}
                >
                  <EditIcon /> <span className="toolbar-label">Note</span>
                </button>
                <button
                  aria-label="Graph"
                  role="tab"
                  aria-selected={ws.view === 'graph'}
                  className={ws.view === 'graph' ? 'on' : undefined}
                  onClick={() => ws.setView('graph')}
                  title={`Graph view (${keyFor('view.graph')})`}
                >
                  <GraphIcon /> <span className="toolbar-label">Graph</span>
                </button>
                <button
                  aria-label="Board"
                  role="tab"
                  aria-selected={ws.view === 'board'}
                  className={ws.view === 'board' ? 'on' : undefined}
                  onClick={() => ws.setView('board')}
                  title="Board: every job of a workflow, by stage"
                >
                  <BoardIcon /> <span className="toolbar-label">Board</span>
                </button>
                <button
                  role="tab"
                  aria-selected={ws.view === 'samples'}
                  className={ws.view === 'samples' ? 'on' : undefined}
                  onClick={() => ws.setView('samples')}
                  aria-label="Samples"
                  title="Samples: every sample, and a map of each freezer"
                >
                  <SampleIcon /> <span className="toolbar-label">Samples</span>
                </button>
              </div>
              <div className="toolbar-spacer" />
              <div className="my-tasks-anchor">
                <button
                  className={`icon-button my-tasks-button${tasksOpen ? ' on' : ''}`}
                  onClick={() => setTasksOpen((open) => !open)}
                  aria-expanded={tasksOpen}
                  aria-label={`My tasks${myTasks.length ? `, ${myTasks.length} waiting` : ''}`}
                  title="My tasks: jobs waiting on you"
                >
                  <TasksIcon />
                  {myTasks.length > 0 && <span className="badge">{myTasks.length}</span>}
                </button>
                {tasksOpen && <MyTasks onClose={closeTasks} />}
              </div>
              <button
                aria-label="Search"
                className="text-button"
                onClick={() => setOverlay('search')}
                title={`Search all notes (${keyFor('app.search')})`}
              >
                <SearchIcon /> <span className="toolbar-label">Search</span>
              </button>
              {canKeepNotebook && (
                <button
                  aria-label="Today"
                  className="text-button"
                  onClick={() => void ws.openToday()}
                  title={`Today's notebook entry (${keyFor('note.today')})`}
                >
                  <TodayIcon /> <span className="toolbar-label">Today</span>
                </button>
              )}
              {canCreate && (
                <button
                  aria-label="New from template"
                  className="text-button"
                  onClick={() => ws.showTemplatePicker(ws.currentFolder())}
                >
                  <TemplateIcon /> <span className="toolbar-label">New from template</span>
                </button>
              )}
              <button
                aria-label="Switch vault"
                className="text-button"
                onClick={() => void openVault()}
                title={`Open another vault (${keyFor('vault.open')})`}
              >
                <VaultIcon /> <span className="toolbar-label">Switch vault</span>
              </button>
              {linksHidden && (
                <button
                  className="icon-button panel-toggle"
                  onClick={togglePanel(linksPanel)}
                  title={`Show links (${keyFor('view.toggleLinks')})`}
                  aria-label="Show links"
                >
                  <SidebarRightIcon />
                </button>
              )}
            </div>
            {trouble && !settingsOpen && (
              <div className="banner warning settings-trouble">
                <span>{trouble.message}</span>
                <button onClick={() => setOverlay(trouble.tab)}>Show</button>
              </div>
            )}
            {update && (
              <div className="banner info update-ready">
                <span>Prem {update} is ready. It's installed when you restart.</span>
                <button onClick={() => void window.api.app.installUpdate()}>Restart now</button>
                <button onClick={() => setUpdate(null)}>Later</button>
              </div>
            )}
            {ws.notice && (
              <div className={`banner ${ws.noticeKind}`}>
                <span>{ws.notice}</span>
                <button onClick={() => ws.showNotice(null)}>Dismiss</button>
              </div>
            )}
            <div className="main-content">
              {ws.view === 'graph' ? (
                <GraphView />
              ) : ws.view === 'board' ? (
                <BoardView />
              ) : ws.view === 'samples' ? (
                <SamplesView />
              ) : ws.active ? (
                <NoteEditor key={ws.active.path} path={ws.active.path} cursor={ws.active.cursor} />
              ) : (
                <EmptyState />
              )}
            </div>
          </main>
        </Panel>
        <Separator className="resize-handle" />
        <Panel
          id="links"
          defaultSize="22%"
          minSize="180px"
          maxSize="40%"
          collapsible
          collapsedSize={0}
          panelRef={linksPanel}
          onResize={() => setLinksHidden(!!linksPanel.current?.isCollapsed())}
        >
          <BacklinksPanel onHide={togglePanel(linksPanel)} />
        </Panel>
      </Group>
      {ws.templatePickerFolder !== null && <TemplatePicker folder={ws.templatePickerFolder} />}
      {overlay === 'search' && <SearchPalette onClose={() => setOverlay(null)} />}
      {overlay === 'commands' && <CommandPalette onClose={() => setOverlay(null)} />}
      {overlay === 'notes' && <QuickSwitcher onClose={() => setOverlay(null)} />}
      {sheet}
      {report}
      {settings}
    </div>
  )
}

interface FileTrouble {
  problems: string[]
  error: string | null
}

/** A one-line warning about settings.json or keybindings.json, and which Settings tab explains it. */
function troubleWith(
  settings: FileTrouble,
  keys: FileTrouble
): { message: string; tab: 'settings' | 'keybindings' } | null {
  if (settings.error)
    return {
      message: `settings.json has a mistake at ${settings.error}. Your last good settings are in use.`,
      tab: 'settings'
    }
  if (keys.error)
    return {
      message: `keybindings.json has a mistake at ${keys.error}. Your last good shortcuts are in use.`,
      tab: 'keybindings'
    }
  if (settings.problems.length) return { message: 'Some entries in settings.json were ignored.', tab: 'settings' }
  if (keys.problems.length) return { message: 'Some entries in keybindings.json were ignored.', tab: 'keybindings' }
  return null
}

function EmptyState() {
  const ws = useWorkspace()
  const { info, canWrite } = useVault()
  const notebook = useNotebookFolder(info?.user)
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
