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

Signatures are **attestations tied to the authenticated user** (team-server token, or the OS user locally); they are tamper-evident but not cryptographic yet.

## Team server

[`src/server`](../src/server) wraps a `LocalFsProvider` in a small Node HTTP server (no framework, no database):

- **Auth**: one bearer token per person or bot; only SHA-256 hashes are stored in the config.
- **Permissions**: per-folder `none` / `read` / `write` rules ([`shared/vault/access.ts`](../src/shared/vault/access.ts)); the deepest matching rule wins; unmatched paths are invisible. Listings, reads, search results and live events are all filtered by them.
- **Attribution**: the author of every save, signature and witness comes from the token, never from the request body.
- **Change stream**: `GET /api/events` is server-sent events, filtered per user; a client's own saves are not echoed back to it.

The server bundles to a single file (`out/server/index.js`) with only Node built-ins, so deploying it is copying one file.

## Renderer

- The editor is CodeMirror 6 with a live-preview extension that hides markdown syntax except on the active line, and widgets for wikilinks, checkboxes, tables, math (KaTeX) and attachments.
- State lives in three contexts: `VaultContext` (what's open, permissions), `LinkIndexContext` (backlinks/graph snapshot from main), `WorkspaceContext` (open note, views, actions).
- The renderer is sandboxed with context isolation; it can only call the typed `window.api`, and every argument is re-validated in `main/ipc/handlers.ts`.

## Testing

- Unit tests (Vitest) sit next to the code they test in `shared/`, `main/vault/` and `server/`. Server tests start a real server on a random port and exercise it through `RemoteProvider`.
- Features are also checked in the running app with Playwright driving Electron; these walkthroughs are being turned into `e2e/` specs run in CI.
