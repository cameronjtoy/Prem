import { app, Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'
import { accelerator, commandById, defaultBindings, type CommandId, type KeyBinding } from '@shared/commands'
import { Channels } from '@shared/vault/ipc'

type Entry = CommandId | '-' | MenuItemConstructorOptions

/** Which commands each menu shows, in order. Titles and shortcuts come from the shared command list. */
const LAYOUT: Record<string, Entry[]> = {
  File: ['note.new', 'note.newFromTemplate', 'note.today', '-', 'vault.open', '-', 'note.save', 'note.exportPdf'],
  Edit: [
    { role: 'undo' },
    { role: 'redo' },
    '-',
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
    '-',
    'format.bold',
    'format.italic',
    'format.strike',
    'format.link',
    'format.task',
    '-',
    'format.heading1',
    'format.heading2',
    'format.heading3'
  ],
  View: [
    'app.commandPalette',
    '-',
    'view.graph',
    'view.toggleFiles',
    'view.toggleLinks',
    '-',
    { role: 'zoomIn', label: 'Larger text' },
    { role: 'zoomOut', label: 'Smaller text' },
    { role: 'resetZoom', label: 'Actual size' },
    '-',
    { role: 'togglefullscreen' }
  ],
  Go: ['app.search', 'app.quickSwitcher', '-', 'nav.back', 'nav.forward'],
  Note: [
    'note.history',
    'note.reveal',
    '-',
    'note.attach',
    'note.insertDateTime',
    '-',
    'note.sign',
    '-',
    'run.start',
    'run.addDeviation',
    '-',
    // Not "Run Python cell": its Shift+Enter would be taken by the macOS menu even while typing elsewhere.
    'analysis.runAll',
    'analysis.stop',
    'analysis.restart'
  ],
  Help: ['app.shortcuts', '-', 'help.website', 'help.reportIssue']
}

export function buildMenu(
  getWindow: () => BrowserWindow | null,
  bindings: Map<string, KeyBinding> = defaultBindings()
): Menu {
  const mac = process.platform === 'darwin'

  const item = (entry: Entry): MenuItemConstructorOptions => {
    if (entry === '-') return { type: 'separator' }
    if (typeof entry !== 'string') return entry
    const command = commandById(entry)
    const binding = bindings.get(entry)
    return {
      label: command?.title ?? entry,
      accelerator: binding ? accelerator(binding) : undefined,
      // The window handles shortcuts itself, so it can let the editor have keys a command can't use right now.
      // Windows and Linux would otherwise run the command twice; macOS always registers menu shortcuts.
      registerAccelerator: false,
      click: () => getWindow()?.webContents.send(Channels.command, entry)
    }
  }

  const template: MenuItemConstructorOptions[] = Object.entries(LAYOUT).map(([label, entries]) => ({
    label,
    role: label === 'Help' ? 'help' : undefined,
    submenu: entries.map(item)
  }))

  if (!app.isPackaged) {
    const view = template.find((m) => m.label === 'View')!
    ;(view.submenu as MenuItemConstructorOptions[]).push(
      { type: 'separator' },
      { role: 'reload' },
      { role: 'toggleDevTools' }
    )
  }

  if (mac) {
    template.unshift({
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { ...item('app.settings'), label: 'Settings…' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
    template.splice(template.length - 1, 0, { role: 'windowMenu' })
  } else {
    const file = template.find((m) => m.label === 'File')!
    ;(file.submenu as MenuItemConstructorOptions[]).push(
      { type: 'separator' },
      { ...item('app.settings'), label: 'Settings…' },
      { type: 'separator' },
      { role: 'quit', label: 'Exit' }
    )
  }

  return Menu.buildFromTemplate(template)
}

/** Sets the application menu. Called again whenever keybindings.json changes, so menus show the new shortcuts. */
export function installMenu(getWindow: () => BrowserWindow | null, bindings?: Map<string, KeyBinding>): void {
  Menu.setApplicationMenu(buildMenu(getWindow, bindings))
}
