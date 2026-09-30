# Prem

A desktop knowledge hub in the style of Obsidian, where technical and business teams keep reference notes, formulas and runbooks. Notes are plain markdown files in a folder (a "vault"), so they stay portable and work with git or any other editor.

## Features
- **Live-preview editor** (CodeMirror 6). Markdown syntax is hidden except on the line you're editing.
- **Wikilinks** such as `[[Note name]]`, `[[Note|alias]]` and `[[Note#Heading]]`. Links autocomplete after `[[`. A link to a note that doesn't exist yet appears faded, and clicking it creates the note.
- **Equations** with KaTeX: `$inline$` and `$$ block $$`.
- **Runbook-friendly markdown**: clickable checkboxes, syntax-highlighted code blocks and rendered tables.
- **Attachments**: drag files into a note, or paste a screenshot. They're saved in an `attachments/` folder next to the note and linked with ordinary markdown, so they still work in other editors. Images and CSV/TSV files preview in the note; other files show as links. Clicking opens a file in its default app. Only known data formats (images, PDFs, spreadsheets, sequence and structure files, and so on) are opened directly; anything else, such as scripts, is shown in its folder instead so it can't run by accident. Attachments can be up to 100 MB.
- **History**: every save of every note is kept, with who made it and when, including edits made in other apps. The History button on a note lists versions grouped into editing sessions, shows what changed since any of them, and restores one as a normal, undoable edit. History lives in a hidden `.prem` folder in the vault, so it's backed up with the vault. Each note's history is a hash-chained, append-only log, so any later change to a past entry can be detected. On a team vault, the server records who saved each version from their token.
- **Signing**: experiments, runs, daily entries and protocols have a bar to **sign** them. Signing records who signed, when, and an optional statement in the note's tamper-evident history, and **locks** the note: it can't be edited or deleted (it can still be moved). Someone else, such as the PI, can **witness** the signature. To change a signed note, **amend** it with a reason; the signed version stays in History and the note shows as amended until it's signed again. Prem flags a signed note whose file was changed outside the app, even while the app was closed. Signatures record identity from your team-server login (or your computer's user name for a local vault); they aren't cryptographic signatures yet.
- **Backlinks panel** listing every note that links to the current one, with the surrounding text.
- **Graph view** of how notes connect.
- **Lab notebook templates**: the `templates/` folder in a new vault gets Experiment, Protocol, Sample, Lab meeting and Reference templates. Templates can use `{{title}}`, `{{date}}`, `{{time}}`, `{{author}}` and `{{cursor}}`.
- **Protocol runs**: a note with `type: protocol` gets a **Start run** button. A run is a new note in your notebook (`Notebook/Runs/2026/…`) with a snapshot of the protocol's Materials and Steps, and it records who ran it and when. Ticking a step records the time next to it, **Add deviation** logs a timestamped note, and **Complete run** records when it finished. The protocol lists its runs under Backlinks.
- **Today** (⌘T) opens today's notebook entry, creating it from `templates/Daily entry.md` the first time. Entries are filed by year: `Notebook/2026/2026-09-30.md` in a local vault, or `Notebooks/<your name>/2026/…` in a team vault so each person's notebook can have its own permissions.
- **External edits** made while the app is open are picked up automatically. If the note you're editing also has unsaved changes, the app asks which version to keep.
- **Team vaults**: run the Prem server to host one vault for a whole team, with a token per person or bot and per-folder permissions. See [Hosting a team vault](#hosting-a-team-vault).

## Getting started
```bash
npm install
npm run dev
```
Then choose **Open a folder as a vault** and pick `sample-vault/`, or any other folder.

`prem-vault/` holds the runbooks for deploying and running your own Prem team server. Start with `Deploying Prem`.

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
| ⌘T | Today's notebook entry |
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

**Permissions** map folders to `none`, `read` or `write`. The rule for the deepest matching folder wins, and anything no rule covers is hidden. For example, `{ "": "read", "Finance": "write" }` lets someone read everything and edit only Finance, and `{ "Runbooks": "read" }` gives a support bot read-only access to runbooks and nothing else. Notes someone can't read never reach their app: they don't appear in the file tree, links, graph or live updates. Notes someone can read but not edit open as read-only, and the app only offers actions they're allowed to do.

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
