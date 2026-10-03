# Changelog

All notable changes to Prem are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Prem uses [semantic versioning](https://semver.org/). While the major version is 0, minor releases may change behaviour.

## [Unreleased]

Everything below will ship as **0.1.0**, the first pilot release.

### Added
- **Python package `prem-notebook`** (`import prem`): write to the notebook from scripts, Jupyter and Python cells.
  - `entry.attach(fig)` saves a matplotlib figure, a DataFrame or any file next to the note and adds it to the note.
  - `entry.record("Colonies", 84)` fills in the Results table, and `entry.tables()` reads every table back as DataFrames.
  - It works with a vault folder or a team server. On a server, your permissions apply and changes are recorded under your name. In a local vault, Prem records them as changes made outside Prem.
  - Signed notes are never changed. It has no required dependencies, works on Python 3.9 and later, and is released to PyPI from GitHub with trusted publishing. See `docs/python.md`.
- **Hide and show the side panels from the screen**: each side panel has a hide button, and a button in the toolbar brings it back (as do ⌘\ and ⌘⇧\). Whether they're shown, and their widths, are kept between launches.
- **New logo**: a ring molecule whose atoms are also the nodes of a graph, branching out like linked notes. It's the app icon on every platform, on the welcome screen and on the website.
- **Analysis cells**: a `python {run}` block in a note gets a Run button (⇧↵ in the code, ⌥⌘↵ for all cells). Its output (printed text, the last value, pandas tables, matplotlib figures and errors) is written under the cell as plain markdown, with figures and tables stored as attachments. A record line says what produced it: code fingerprint, time, who, Python, environment and the SHA-256 of every file read. Outputs are saved in history, covered by signing and printed in PDF exports. Changed code is flagged, signed notes can't be run, and on a team vault Prem asks before running code someone else changed. New **Analysis** template.
- **Python for analyses** (groundwork for analysis cells): Prem finds Python on your computer (or the one uv manages) and builds one environment per vault from its `environment.txt`, with uv or `venv` + pip, kept outside the vault. Settings → Analysis shows what it found and sets the environment up. Each note gets its own Python process; results record the Python version, the environment and the SHA-256 of every file the code read. See `docs/analysis.md`.
- **Your own shortcuts**: Settings → Keyboard shortcuts lists every command; press new keys to change one, with a prompt when another command already uses them. Changes are saved in `keybindings.json` (`{ "key": "Mod+Shift+L", "command": "format.link" }`, or `"-note.today"` to remove one), which applies as soon as it's saved, menus included.
- **Settings** (⌘,): theme (system, light or dark), text size, line width, spelling, line numbers, autosave delay, the inserted date and time format, the notebook folder, confirming before moving to the trash, and PDF page size (A4 or US Letter). Each is also in `settings.json`, which holds only what you changed and applies as soon as it's saved; a mistake in it is reported with its line, and the last good settings stay in use. The last vault Prem opened is now kept separately in `state.json`, moved there automatically.
- **Keyboard and menus**: a command palette (⇧⌘P) listing every command you can run, a note switcher (⌘E), back and forward through the notes you opened (⌘[ / ⌘]), and a shortcuts sheet (⌘/). New shortcuts for formatting (bold, italic, strikethrough, headings, links), ticking a step with its time (⌘↵), inserting the date and time, attaching a file, signing, starting a run, logging a deviation, history, and hiding the side panels. An application menu (File, Edit, View, Go, Note, Help) shows them all.
- **Notebook**: daily entries (⌘T) filed by year; templates for Experiment, Protocol, Sample, Lab meeting, Reference and Daily entry, with `{{title}}`, `{{date}}`, `{{time}}`, `{{author}}` and `{{cursor}}`.
- **Editor**: live-preview markdown (CodeMirror), KaTeX equations, tables, checkboxes, wikilinks with autocomplete, backlinks and a graph view.
- **Attachments**: drop or paste files into an entry. Images and CSV/TSV preview inline; known data formats open in their default app and anything else is revealed in its folder. 100 MB limit.
- **Notebook previews**: an attached Jupyter notebook (`.ipynb`) shows inline with its markdown and equations, highlighted code and the outputs saved in the file: text, tables, plots and errors. Nothing runs, notebook HTML is sanitized, and only images embedded in the file are shown. **Open** hands it to Jupyter or whichever app opens notebooks.
- **Protocol runs**: Start run copies a protocol's materials and steps into a run note. Ticking a step records the time; Add deviation and Complete run.
- **Links follow renames**: renaming or moving a note, attachment or folder rewrites `[[links]]` and relative links and embeds to it in every note you can edit, keeping each link's style, heading and alias. A moved note's own images keep working. Signed notes are never changed; Prem lists the ones that still use the old name.
- **Search** (⌘K) across titles, folders and text, with quoted phrases. Results open at the match.
- **History**: every save kept, including edits made outside Prem, in a hash-chained log per note. View, diff and restore versions.
- **Signing**: sign, witness, lock and amend records. Signed notes changed outside Prem are flagged.
- **PDF export** (⌘P, or right-click a note or folder): metadata as a table, images embedded, equations, and a record block listing every signature, witness and amendment, the history check and a SHA-256 of the printed content. Nothing in a note can run or load from the network while it prints.
- **Lab server setup**: `prem-server init` creates the vault, a notebook per person and a token for each, with PI, member and viewer roles and private or shared notebooks. `add`, `remove`, `token` and `list` manage people; changes to the config apply without a restart, and anyone whose access changed is reconnected with the new rules. A broken config is reported and the previous one kept. `docs/lab-server.md` covers setup, HTTPS with Tailscale or Caddy, and backups.
- **Team server**: one vault for a lab, with a token per person, per-folder `none`/`read`/`write` permissions, live updates and conflict protection. Notes you can't edit open read-only.
- **Installers**: macOS (`.dmg`, Apple silicon and Intel), Windows (`.exe`) and Linux (AppImage and `.deb`), built for each tagged release with checksums. Not signed yet; see `docs/install.md`.
- **Server packages**: the team server as a Docker image on GitHub Container Registry and as a single file for Node.js.
- **Project**: Apache-2.0 license, CI, Prettier and oxlint, end-to-end tests of the app and team server in CI, contributor guide, security policy, code of conduct, issue and pull request templates, Dependabot and CodeQL, `docs/ARCHITECTURE.md`, a release workflow, `THIRD_PARTY_NOTICES.md` in every installer, a website on GitHub Pages, and a lab sample vault in `examples/sample-vault/`.

### Changed
- **New note and New folder ask for the name first**: nothing is created until you type a name and press Enter. Esc or clicking away drops it, so no more stray "Untitled" notes. A name that's already taken is refused.
- **Typography**: San Francisco (SF Pro and SF Mono) on macOS as before, and now **Inter** and **JetBrains Mono**, bundled, on Windows and Linux instead of whatever the system had. The website uses Inter too.
- A new or empty vault suggests where to start: today's entry, a new experiment, or a protocol, depending on what you can write.
- Backlinks show readable text instead of raw markdown.

### Fixed
- Clicking a template quickly could create the note from the previously highlighted template instead.

### Security
- The team server rejects paths with hidden segments (`.prem`, `.trash`, `.git`), so deleted notes and history files can't be fetched directly.
- The author of every save, signature and witness comes from the authenticated token, never from the request.

[Unreleased]: https://github.com/cameronjtoy/Prem/commits/main
