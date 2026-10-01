# Changelog

All notable changes to Prem are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Prem uses [semantic versioning](https://semver.org/). While the major version is 0, minor releases may change behaviour.

## [Unreleased]

Everything below will ship as **0.1.0**, the first pilot release.

### Added
- **Notebook**: daily entries (⌘T) filed by year; templates for Experiment, Protocol, Sample, Lab meeting, Reference and Daily entry, with `{{title}}`, `{{date}}`, `{{time}}`, `{{author}}` and `{{cursor}}`.
- **Editor**: live-preview markdown (CodeMirror), KaTeX equations, tables, checkboxes, wikilinks with autocomplete, backlinks and a graph view.
- **Attachments**: drop or paste files into an entry. Images and CSV/TSV preview inline; known data formats open in their default app and anything else is revealed in its folder. 100 MB limit.
- **Protocol runs**: Start run copies a protocol's materials and steps into a run note. Ticking a step records the time; Add deviation and Complete run.
- **Search** (⌘K) across titles, folders and text, with quoted phrases. Results open at the match.
- **History**: every save kept, including edits made outside Prem, in a hash-chained log per note. View, diff and restore versions.
- **Signing**: sign, witness, lock and amend records. Signed notes changed outside Prem are flagged.
- **PDF export** (⌘P, or right-click a note or folder): metadata as a table, images embedded, equations, and a record block listing every signature, witness and amendment, the history check and a SHA-256 of the printed content. Nothing in a note can run or load from the network while it prints.
- **Lab server setup**: `prem-server init` creates the vault, a notebook per person and a token for each, with PI, member and viewer roles and private or shared notebooks. `add`, `remove`, `token` and `list` manage people; changes to the config apply without a restart, and anyone whose access changed is reconnected with the new rules. A broken config is reported and the previous one kept. `docs/lab-server.md` covers setup, HTTPS with Tailscale or Caddy, and backups.
- **Team server**: one vault for a lab, with a token per person, per-folder `none`/`read`/`write` permissions, live updates and conflict protection. Notes you can't edit open read-only.
- **Installers**: macOS (`.dmg`, Apple silicon and Intel), Windows (`.exe`) and Linux (AppImage and `.deb`), built for each tagged release with checksums. Not signed yet; see `docs/install.md`.
- **Server packages**: the team server as a Docker image on GitHub Container Registry and as a single file for Node.js.
- **Project**: Apache-2.0 license, CI, Prettier and oxlint, contributor guide, security policy, code of conduct, issue and pull request templates, Dependabot and CodeQL, `docs/ARCHITECTURE.md`, a release workflow, `THIRD_PARTY_NOTICES.md` in every installer, a website on GitHub Pages, and a lab sample vault in `examples/sample-vault/`.

### Security
- The team server rejects paths with hidden segments (`.prem`, `.trash`, `.git`), so deleted notes and history files can't be fetched directly.
- The author of every save, signature and witness comes from the authenticated token, never from the request.

[Unreleased]: https://github.com/cameronjtoy/Prem/commits/main
