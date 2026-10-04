import type { ReportInfo } from '../diagnostics'
import type { IpcResult } from './errors'
import type { AnalysisStatus } from '../analysis/environment'
import type { Reproduction } from '../analysis/reproduce'
import type { CellResult } from '../analysis/results'
import type { Approval, RunCheck } from '../analysis/trust'
import type { KeybindingsSnapshot } from '../keybindings'
import type { SettingKey, SettingsSnapshot } from '../settings/schema'
import type { HistoryEntry } from '../records/history'
import type { SearchHit } from '../search/search'
import type { RecordCheck } from '../records/signatures'
import type {
  AddedAttachment,
  CreatedNote,
  FileRecord,
  IndexSummary,
  LinkIndexSnapshot,
  NoteLinks,
  RenameResult,
  TemplateInfo,
  VaultChange,
  VaultEntry,
  VaultInfo,
  WriteOptions,
  WriteResult
} from './types'

export const Channels = {
  pickAndOpen: 'vault:pickAndOpen',
  openLast: 'vault:openLast',
  connect: 'vault:connect',
  list: 'vault:list',
  read: 'vault:read',
  write: 'vault:write',
  mkdir: 'vault:mkdir',
  rename: 'vault:rename',
  remove: 'vault:delete',
  readBinary: 'vault:readBinary',
  history: 'history:list',
  readVersion: 'history:read',
  recordStatus: 'record:status',
  sign: 'record:sign',
  witness: 'record:witness',
  exportPdf: 'record:exportPdf',
  backupVault: 'vault:backup',
  addAttachment: 'attachments:add',
  pickAttachments: 'attachments:pick',
  openFile: 'attachments:open',
  listTemplates: 'templates:list',
  createFromTemplate: 'templates:create',
  openDaily: 'notebook:openDaily',
  getIndex: 'index:get',
  indexLinks: 'index:links',
  indexGraph: 'index:graph',
  search: 'search:query',
  openExternal: 'app:openExternal',
  logError: 'app:logError',
  diagnostics: 'app:diagnostics',
  showLogs: 'app:showLogs',
  command: 'app:command',
  getSettings: 'settings:get',
  setSetting: 'settings:set',
  openSettingsFile: 'settings:openFile',
  settingsChanged: 'settings:changed',
  getKeybindings: 'keybindings:get',
  setKeybinding: 'keybindings:set',
  resetKeybinding: 'keybindings:reset',
  openKeybindingsFile: 'keybindings:openFile',
  keybindingsChanged: 'keybindings:changed',
  analysisStatus: 'analysis:status',
  analysisPrepare: 'analysis:prepare',
  analysisRun: 'analysis:run',
  analysisInterrupt: 'analysis:interrupt',
  analysisRestart: 'analysis:restart',
  analysisProgress: 'analysis:progress',
  analysisReproduce: 'analysis:reproduce',
  analysisInputHashes: 'analysis:inputHashes',
  analysisCheck: 'analysis:check',
  analysisApprove: 'analysis:approve',
  vaultChanged: 'vault:changed',
  indexUpdated: 'index:updated'
} as const

type R<T> = Promise<IpcResult<T>>

/** The surface exposed to the renderer as `window.api`. */
export interface Api {
  vault: {
    pickAndOpen(): R<VaultInfo | null>
    openLast(): R<VaultInfo | null>
    connect(url: string, token: string): R<VaultInfo>
    list(): R<VaultEntry[]>
    read(path: string): R<FileRecord>
    write(path: string, content: string, options?: WriteOptions): R<WriteResult>
    mkdir(path: string): R<void>
    /** Moves a note, attachment or folder, and rewrites links to it in other notes. */
    rename(from: string, to: string): R<RenameResult>
    remove(path: string): R<void>
    readBinary(path: string): R<Uint8Array>
    onChanged(listener: (changes: VaultChange[]) => void): () => void
  }
  attachments: {
    add(notePath: string, fileName: string, data: Uint8Array): R<AddedAttachment>
    /** Asks which files to attach, stores them next to the note, and returns the markdown for each. */
    pick(notePath: string): R<string[]>
    /** Opens a file in its default app, or shows it in its folder if it isn't a known data format. */
    open(path: string): R<void>
  }
  history: {
    list(path: string): R<HistoryEntry[]>
    read(path: string, id: string): R<string>
  }
  record: {
    status(path: string): R<RecordCheck>
    sign(path: string, statement?: string): R<RecordCheck>
    witness(path: string): R<RecordCheck>
    /**
     * Asks where to save, then prints a note or every note in a folder to PDF with its signatures and
     * history check. Returns the saved file, or null if the person cancelled.
     */
    exportPdf(path: string): R<{ file: string; notes: number } | null>
    /** Asks where to save, then zips the whole vault there, history included. Null if cancelled. */
    backup(): R<{ file: string; files: number; bytes: number } | null>
  }
  templates: {
    list(): R<TemplateInfo[]>
    create(templatePath: string, title: string, folder: string): R<CreatedNote>
  }
  notebook: {
    /** Opens or creates the daily entry for a YYYY-MM-DD day. */
    openDaily(day: string): R<CreatedNote>
  }
  search(query: string): R<SearchHit[]>
  index: {
    /** The small summary: version, workflows and jobs. */
    get(): R<IndexSummary | null>
    /** The links into and out of one note. */
    links(path: string): R<NoteLinks | null>
    /** Every note and link, for the graph view. */
    graph(): R<LinkIndexSnapshot['graph'] | null>
    onUpdated(listener: (summary: IndexSummary) => void): () => void
  }
  settings: {
    get(): R<SettingsSnapshot>
    /** Changes one setting and saves settings.json. Fails with a message if the value isn't allowed. */
    set(key: SettingKey, value: unknown): R<SettingsSnapshot>
    /** Opens settings.json in the person's editor, creating it if needed. */
    openFile(): R<void>
    onChanged(listener: (snapshot: SettingsSnapshot) => void): () => void
  }
  keybindings: {
    get(): R<KeybindingsSnapshot>
    /** Gives a command a new shortcut such as "Mod+Shift+L", or none with null, and saves keybindings.json. */
    set(command: string, key: string | null): R<KeybindingsSnapshot>
    reset(command: string): R<KeybindingsSnapshot>
    /** Opens keybindings.json in the person's editor, creating it if needed. */
    openFile(): R<void>
    onChanged(listener: (snapshot: KeybindingsSnapshot) => void): () => void
  }
  analysis: {
    /** Whether Python was found, and the state of the vault's environment. `refresh` looks for Python again. */
    status(refresh?: boolean): R<AnalysisStatus>
    /** Builds or updates the vault's environment from environment.txt. */
    prepare(): R<AnalysisStatus>
    /** Runs one cell of a note in that note's runner, so it sees variables from cells run before it. */
    run(notePath: string, code: string): R<CellResult>
    /** Stops the cell running in a note. */
    interrupt(notePath: string): R<void>
    /** Ends a note's runner, forgetting its variables. */
    restart(notePath: string): R<void>
    /** Progress while an environment is built, e.g. "Installing packages". */
    onProgress(listener: (message: string) => void): () => void
    /** Reruns cells from the start in a fresh Python, in the recorded environment rebuilt. Writes nothing. */
    reproduce(notePath: string, codes: string[], environment: string | null): R<Reproduction>
    /** The sha256 of each file (null if it's gone), to flag outputs whose inputs changed. */
    inputHashes(paths: string[]): R<Record<string, string | null>>
    /**
     * What needs approving before these cells run: code not approved on this computer, and the environment
     * list if it would be installed. With `reproduce`, the environment Reproduce would rebuild for that note.
     */
    check(codes: string[], reproduce?: { notePath: string; recorded: string | null }): R<RunCheck>
    /** Approves an environment list (by its hash) and cell code to run on this computer. */
    approve(approval: Approval): R<void>
  }
  app: {
    openExternal(url: string): R<void>
    /** Writes an error from the window to Prem's log. */
    logError(message: string): R<void>
    /** What a problem report contains: versions, the system, and the end of the log with private paths removed. */
    diagnostics(): R<ReportInfo>
    /** Opens the folder with Prem's log files. */
    showLogs(): R<void>
    /** Commands chosen from the application menu, by id. */
    onCommand(listener: (id: string) => void): () => void
  }
}
