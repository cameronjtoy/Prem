# Changelog

All notable changes to Prem are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Prem uses [semantic versioning](https://semver.org/). While the major version is 0, minor releases may change behaviour.

## [Unreleased]

Everything below will ship as **0.1.0**, the first pilot release, together with PDF export and a guided lab-server setup.

### Added
- **Notebook**: daily entries (⌘T) filed by year; templates for Experiment, Protocol, Sample, Lab meeting, Reference and Daily entry, with `{{title}}`, `{{date}}`, `{{time}}`, `{{author}}` and `{{cursor}}`.
- **Editor**: live-preview markdown (CodeMirror), KaTeX equations, tables, checkboxes, wikilinks with autocomplete, backlinks and a graph view.
- **Attachments**: drop or paste files into an entry. Images and CSV/TSV preview inline; known data formats open in their default app and anything else is revealed in its folder. 100 MB limit.
- **Protocol runs**: Start run copies a protocol's materials and steps into a run note. Ticking a step records the time; Add deviation and Complete run.
- **Search** (⌘K) across titles, folders and text, with quoted phrases. Results open at the match.
- **History**: every save kept, including edits made outside Prem, in a hash-chained log per note. View, diff and restore versions.
- **Signing**: sign, witness, lock and amend records. Signed notes changed outside Prem are flagged.
- **Team server**: one vault for a lab, with a token per person, per-folder `none`/`read`/`write` permissions, live updates and conflict protection. Notes you can't edit open read-only.
- **Installers**: macOS (`.dmg`, Apple silicon and Intel), Windows (`.exe`) and Linux (AppImage and `.deb`), built for each tagged release with checksums. Not signed yet; see `docs/install.md`.
- **Server packages**: the team server as a Docker image on GitHub Container Registry and as a single file for Node.js.
- **Project**: Apache-2.0 license, CI, Prettier and oxlint, contributor guide, security policy, code of conduct, issue and pull request templates, Dependabot and CodeQL, `docs/ARCHITECTURE.md`, a release workflow, `THIRD_PARTY_NOTICES.md` in every installer, and a lab sample vault in `examples/sample-vault/`.

### Security
- The team server rejects paths with hidden segments (`.prem`, `.trash`, `.git`), so deleted notes and history files can't be fetched directly.
- The author of every save, signature and witness comes from the authenticated token, never from the request.

[Unreleased]: https://github.com/cameronjtoy/Prem/commits/main
