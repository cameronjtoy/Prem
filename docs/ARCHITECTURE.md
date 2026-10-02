# Architecture

Prem is an Electron desktop app plus an optional team server. A **vault** is a folder of markdown notes and attachments; everything Prem adds lives in a hidden `.prem` folder inside it, so a vault is always just files you can back up, keep in git or open in another editor.

## Processes and layers

```
src/
  shared/      Plain TypeScript with no Electron, Node-only or React code, used by every process
    vault/       paths, per-folder access rules, error codes, IPC and HTTP contracts, core types
    notes/       templates, the daily notebook, frontmatter, wikilinks, link index and resolution
    records/     history entries, signing status, protocol runs, line diff
    search/      the in-memory full-text index
    attachments/ attachment naming and links, CSV parsing
  main/        Electron main process
    index.ts     window and app lifecycle
    ipc/         validates renderer requests and routes them to the vault layer
    vault/       VaultProvider interface, LocalFsProvider, RemoteProvider, NoteHistory, VaultManager
  preload/     exposes a narrow, typed `window.api` to the renderer through contextBridge
  renderer/    React UI: file tree, CodeMirror editor and extensions, panels, modals
  server/      the team server: config and tokens, HTTP API, change stream, access checks
```

The rule that keeps this maintainable: **logic goes in `shared/` as pure functions with tests**; `main/` and `server/` wire it to storage; `renderer/` only calls `window.api`. If you find yourself writing business logic in a React component or an IPC handler, it probably belongs in `shared/`.

## The storage seam

[`VaultProvider`](../src/main/vault/VaultProvider.ts) is the one interface everything above storage uses. Paths are vault-relative POSIX strings. Two implementations:

- [`LocalFsProvider`](../src/main/vault/LocalFsProvider.ts) reads and writes a folder on disk. It is the only code that touches the filesystem. Every path is normalised and checked so it cannot escape the vault, including through symlinks ([`safePath.ts`](../src/main/vault/safePath.ts)); hidden paths (`.prem`, `.trash`, `.git`) are refused. Writes are atomic (temp file + rename). A chokidar watcher reports outside changes.
- [`RemoteProvider`](../src/main/vault/RemoteProvider.ts) implements the same interface over HTTP against the team server, and follows its server-sent event stream for live updates, reconnecting with backoff and resyncing what it missed.

[`VaultManager`](../src/main/vault/VaultManager.ts) owns the open provider plus the link index and search index, and exposes higher-level operations (open daily entry, create from template, attach a file, sign, history).

Because the renderer never knows which provider is in use, every feature works identically on a local folder and on a team vault.

## Versioning and conflicts

Every read returns a `version` (derived from mtime and size); every write may carry `expectedVersion`. If the file changed in between, the write fails with `CONFLICT` and the editor shows "keep mine / reload". The team server serialises writes to the same note under a per-path lock so version checks cannot interleave.

## History and signing

[`NoteHistory`](../src/main/vault/NoteHistory.ts) records every version of every note in `.prem/`:

- `.prem/history/<note>.jsonl` is an append-only log. Each entry's `id` is a SHA-256 over its fields plus the previous entry's `id`, so the log is a hash chain: altering, removing or reordering a past entry breaks every id after it (`verify()`).
- `.prem/objects/ab/<hash>.gz` holds each distinct version, compressed and shared between notes. Reads re-check the hash.

Saves, outside edits (from the watcher, or caught up before the next operation), renames, deletions, **signatures, witnesses and amendments** are all entries in this log. [`shared/records/signatures.ts`](../src/shared/records/signatures.ts) folds a log into a `RecordStatus` (draft / signed / witnessed / amended, locked or not); the provider refuses writes and deletes to locked notes unless the save carries an amendment reason.

**PDF export** ([`src/main/export`](../src/main/export)) prints a note, or every note in a folder, from a self-contained HTML page: [`printable.ts`](../src/main/export/printable.ts) turns markdown, metadata, the signing events and the history check into HTML (pure, unit-tested), and [`pdf.ts`](../src/main/export/pdf.ts) embeds vault images and prints it in a hidden window with scripts off. Raw HTML in a note is printed as text and the page's content security policy blocks every network load.

Signatures are **attestations tied to the authenticated user** (team-server token, or the OS user locally); they are tamper-evident but not cryptographic yet.

## Commands and shortcuts

[`shared/commands.ts`](../src/shared/commands.ts) lists every command with its default shortcut, written once with `Mod` (⌘ on macOS, Ctrl elsewhere) and matched on the physical key. The keyboard dispatcher, the application menu ([`main/menu.ts`](../src/main/menu.ts)), the command palette, the shortcuts sheet and the README table all read it; a test fails if the README drifts. Components register what a command does while they're on screen with `useCommand(id, run, enabled)` ([`renderer/src/commands/registry.ts`](../src/renderer/src/commands/registry.ts)): the shell handles navigation, the open note handles formatting and signing. A command that can't run right now leaves its key to the editor, so ⌘[ still indents when there's nothing to go back to.

## Settings

[`shared/settings/schema.ts`](../src/shared/settings/schema.ts) lists every setting with its type, default and allowed values; the Settings screen is built from it and `settings.json` is checked against it. `validate` keeps every good value and reports each bad one, falling back to its default, and `withSetting` writes only what differs from the default while keeping entries Prem doesn't know. [`main/settings.ts`](../src/main/settings.ts) watches the file's folder (so editors that save by replacing the file are seen), and keeps the last good settings while the file has a syntax error. Main applies the theme through `nativeTheme`, so the renderer's `prefers-color-scheme` styles follow it, and sends every change to the renderer, which sets CSS variables and reconfigures the editor in place. What Prem remembers between launches (the last vault or server) is in [`main/state.ts`](../src/main/state.ts) and `state.json`, out of the way of people's settings.

## Renames and links

[`shared/notes/relink.ts`](../src/shared/notes/relink.ts) is a pure function from a note's text to its text after a move: it resolves each wikilink against the vault as it was before (the same resolver the editor uses) and rewrites the ones that pointed at something that moved, and recomputes relative markdown links. `VaultManager.rename` runs it over every note after the provider moves the files, writing with the version it read so a concurrent edit isn't overwritten. Locked and read-only notes are reported, not changed, so a rename never alters a signed record or bypasses permissions. On a team vault this happens in the renaming person's app, through the same permission checks as any other save.

## Team server

[`src/server`](../src/server) wraps a `LocalFsProvider` in a small Node HTTP server (no framework, no database):

- **Auth**: one bearer token per person or bot; only SHA-256 hashes are stored in the config.
- **Permissions**: per-folder `none` / `read` / `write` rules ([`shared/vault/access.ts`](../src/shared/vault/access.ts)); the deepest matching rule wins; unmatched paths are invisible. Listings, reads, search results and live events are all filtered by them.
- **Attribution**: the author of every save, signature and witness comes from the token, never from the request body.
- **Change stream**: `GET /api/events` is server-sent events, filtered per user; a client's own saves are not echoed back to it.
- **Administration**: [`cli.ts`](../src/server/cli.ts) is the command line (`init`, `add`, `remove`, `token`, `list`, and serving). [`lab.ts`](../src/server/lab.ts) holds the roles and the permissions each gets, and edits the config as plain JSON so unknown fields survive. The running server watches its config and calls `updateUsers`, which swaps the people in place and closes the live stream of anyone whose token or permissions changed, so their app reconnects under the new rules.

The server bundles to a single file (`out/server/index.js`) with only Node built-ins, so deploying it is copying one file.

## Renderer

- The editor is CodeMirror 6 with a live-preview extension that hides markdown syntax except on the active line, and widgets for wikilinks, checkboxes, tables, math (KaTeX) and attachments.
- State lives in three contexts: `VaultContext` (what's open, permissions), `LinkIndexContext` (backlinks/graph snapshot from main), `WorkspaceContext` (open note, views, actions).
- The renderer is sandboxed with context isolation; it can only call the typed `window.api`, and every argument is re-validated in `main/ipc/handlers.ts`.

## Testing

- Unit tests (Vitest) sit next to the code they test in `shared/`, `main/vault/` and `server/`. Server tests start a real server on a random port and exercise it through `RemoteProvider`.
- Features are also checked in the running app with Playwright driving Electron; these walkthroughs are being turned into `e2e/` specs run in CI.
