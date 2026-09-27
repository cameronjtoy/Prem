# Prem

A desktop knowledge hub in the style of Obsidian, where technical and business teams keep reference notes, formulas and runbooks. Notes are plain markdown files in a folder (a "vault"), so they stay portable and work with git or any other editor.

## Features
- **Live-preview editor** (CodeMirror 6). Markdown syntax is hidden except on the line you're editing.
- **Wikilinks** such as `[[Note name]]`, `[[Note|alias]]` and `[[Note#Heading]]`. Links autocomplete after `[[`. A link to a note that doesn't exist yet appears faded, and clicking it creates the note.
- **Equations** with KaTeX: `$inline$` and `$$ block $$`.
- **Runbook-friendly markdown**: clickable checkboxes, syntax-highlighted code blocks and rendered tables.
- **Backlinks panel** listing every note that links to the current one, with the surrounding text.
- **Graph view** of how notes connect.
- **Templates**: the `templates/` folder in a vault holds Runbook, Reference and Meeting templates, which are created the first time a vault is opened.
- **External edits** made while the app is open are picked up automatically. If the note you're editing also has unsaved changes, the app asks which version to keep.

## Getting started
```bash
npm install
npm run dev
```
Then choose **Open a folder as a vault** and pick `sample-vault/`, or any other folder.

| Command | What it does |
| --- | --- |
| `npm run dev` | Run the app with hot reload |
| `npm test` | Run the unit tests (link parsing, index, templates, path safety) |
| `npm run typecheck` | Type-check the main, preload and renderer code |
| `npm run build` | Build the production bundles into `out/` |

### Shortcuts
| Shortcut | Action |
| --- | --- |
| ⌘N | New note |
| ⌘⇧N | New note from template |
| ⌘G | Toggle graph view |
| ⌘O | Open another vault |
| ⌘S | Save now (notes also autosave) |
| ⌘-click | Follow a link while its markdown is showing |

## Architecture
```
src/
  shared/     Pure TypeScript used by every process: wikilink parsing, link resolution,
              the link index, templates, path helpers and the IPC contract
  main/       Electron main process: window setup, IPC handlers, and the vault layer
    vault/    VaultProvider interface, LocalFsProvider (fs + chokidar), VaultManager
  preload/    Exposes a narrow, typed `window.api` through contextBridge
  renderer/   React UI: file tree, editor and its CodeMirror extensions, backlinks, graph
```

- **The storage seam.** Only `LocalFsProvider` touches the disk, and everything above it uses vault-relative paths. Every write carries the version it expects to overwrite, so a future sync backend can implement `VaultProvider` without changing the UI.
- **Security.** The renderer runs sandboxed with context isolation and no Node access. Every file path is checked in the main process so it can't escape the vault, including through symlinks. Deleted files go to the OS trash. Writes are atomic.

## Roadmap: sync (phase 2)
- A server with accounts and per-folder permissions, plus a `RemoteProvider` that implements `VaultProvider`
- Real-time co-editing using Yjs with `y-codemirror.next`
- Updating links when a note is renamed, full-text search, and version history

## Troubleshooting
If `npm run dev` fails with `Cannot read properties of undefined (reading 'whenReady')`, your shell has `ELECTRON_RUN_AS_NODE` set. Some editors' integrated terminals and extensions set it. Run `unset ELECTRON_RUN_AS_NODE` and try again.
