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
- **Team vaults**: run the Prem server to host one vault for a whole team, with a token per person or bot and per-folder permissions. See [Hosting a team vault](#hosting-a-team-vault).

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
| `npm run server` | Build and start the team server (see below) |
| `npm run server:token -- <name>` | Create an access token for a person or bot |

### Shortcuts
| Shortcut | Action |
| --- | --- |
| ⌘N | New note |
| ⌘⇧N | New note from template |
| ⌘G | Toggle graph view |
| ⌘O | Open another vault |
| ⌘S | Save now (notes also autosave) |
| ⌘-click | Follow a link while its markdown is showing |

## Hosting a team vault
The team server hosts a single vault folder so everyone works from the same runbooks and notes. It's a small Node process with no database: the vault stays a folder of markdown files, so you can still back it up or keep it in git.

1. Create a token for each person or bot. The command prints the token (hand it to that person; it isn't stored) and a config entry holding only its hash:
   ```bash
   npm run server:token -- alice
   ```
2. Copy `prem-server.example.json` to `prem-server.json`, set `vault` to your folder, and paste in the user entries.
3. Start the server: `npm run server`
4. In the app, choose **Join your team's vault** and enter the server address and your token.

**Permissions** map folders to `none`, `read` or `write`. The rule for the deepest matching folder wins, and anything no rule covers is hidden. For example, `{ "": "read", "Finance": "write" }` lets someone read everything and edit only Finance, and `{ "Runbooks": "read" }` gives a support bot read-only access to runbooks and nothing else. Notes someone can't read never reach their app: they don't appear in the file tree, links, graph or live updates.

**Deploying.** The server listens on `127.0.0.1:4747` by default. To share it, put it behind a reverse proxy that terminates HTTPS (Caddy, nginx or your load balancer) and set `host` to `0.0.0.0` if the proxy runs on another machine. The app only sends tokens over `https://`, except to `localhost`. `GET /api/health` needs no token, for health checks. Saves, moves and deletes are logged with the user's name, and deleted notes go to a `.trash` folder inside the vault.

**Conflicts.** Every save carries the version it was based on. If a teammate saved first, you get the usual "keep mine or reload" prompt instead of silently overwriting their work. Open notes update live when someone else saves.

## Architecture
```
src/
  shared/     Pure TypeScript used by every process: wikilink parsing, link resolution,
              the link index, templates, path helpers and the IPC contract
  main/       Electron main process: window setup, IPC handlers, and the vault layer
    vault/    VaultProvider interface, LocalFsProvider (fs + chokidar), RemoteProvider (team
              server over HTTP), VaultManager
  server/     Team server: config and tokens, per-folder access checks, HTTP API and change stream
  preload/    Exposes a narrow, typed `window.api` through contextBridge
  renderer/   React UI: file tree, editor and its CodeMirror extensions, backlinks, graph
```

- **The storage seam.** Only `LocalFsProvider` touches the disk, and everything above it uses vault-relative paths. Every write carries the version it expects to overwrite. `RemoteProvider` implements the same interface against the team server, so the editor, link index and graph work unchanged on a shared vault.
- **The team server** wraps a `LocalFsProvider`. It checks each request's token and folder permissions, serialises writes to the same note, and streams changes to connected apps as server-sent events, filtered to what each user can read.
- **Security.** The renderer runs sandboxed with context isolation and no Node access. Every file path is checked in the main process so it can't escape the vault, including through symlinks. Deleted files go to the OS trash. Writes are atomic.

## Roadmap
- Done: a team server with per-user tokens and per-folder permissions, plus a `RemoteProvider`
- An MCP server so agents can pull runbooks and notes, with owner and review date attached, under the same permissions
- SSO (OIDC) instead of hand-issued tokens, and an admin screen for users and permissions
- Real-time co-editing using Yjs with `y-codemirror.next`
- Updating links when a note is renamed, full-text search, and version history

## Troubleshooting
If `npm run dev` fails with `Cannot read properties of undefined (reading 'whenReady')`, your shell has `ELECTRON_RUN_AS_NODE` set. Some editors' integrated terminals and extensions set it. Run `unset ELECTRON_RUN_AS_NODE` and try again.
