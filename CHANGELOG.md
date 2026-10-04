# Changelog

All notable changes to Prem are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and Prem uses [semantic versioning](https://semver.org/). While the major version is 0, minor releases may change behaviour.

## [Unreleased]

Everything below will ship as **0.1.0**, the first pilot release.

### Added
- **Ready for signed installers and updates**: once the maintainers add signing certificates, releases are signed and notarized automatically. Installed copies then check for a new version once a day, download it in the background and offer to restart. **Settings → Updates** turns this off. Until then, the Linux AppImage updates itself and other installers stay as they are.
- **The board and My tasks**:
  - **The board:** a Board view next to Note and Graph shows every job of a workflow in a column per stage, with who has it, whether its run is open, and its samples. Filter by assignee, and show finished jobs if you like.
  - **Moving cards:** drag a card to the next column to complete its stage (Prem asks first), or back to send it back with a reason. Signed jobs stay put.
  - **My tasks** in the toolbar counts the jobs waiting on you and opens them.
  - **On a team server**, only a job's assignee or a PI can move it to another stage, and the server enforces this. New labs let members write to `Jobs`.
- **Asking before code runs**:
  - **Packages:** Prem shows the package list before installing `environment.txt` or a list that Reproduce rebuilds, and shows what changed when it changes. Lines that install from web addresses, files or other package indexes are pointed out.
  - **Code:** Prem shows a cell's code, and who changed the note last, before it runs for the first time on this computer. This applies on every vault, including local folders that are synced or shared. Code you write in Prem needs no approval, and code that changes elsewhere is asked about again.
  - **Where approvals live:** they're kept on your computer as fingerprints, outside the vault.
- **Safer connections from Python:** `prem.connect` refuses plain `http://` to other computers (`insecure=True` overrides it, with a warning), and doesn't follow redirects, so the token only goes where you sent it.
- **Failed sign-ins are logged:** repeated sign-ins with an invalid token are logged on the team server.
- **Tighter security policy:** the app's Content-Security-Policy now also blocks plugins, frames, form submissions and `<base>` changes.
- **Workflows and jobs**: a `type: workflow` note lists a process's stages in a table, each with a protocol (or none), a default assignee and its outputs; a new **Workflow** template starts one. **New job** files a job under `Jobs/<workflow>/` with a copy of the stages. The job's bar shows its stage and assignee, starts the stage's run (linked both ways), and **Complete stage** logs the time and hands the job to the next stage's assignee, asking first if the run isn't complete. Finished jobs can be signed to lock their stage log. **Send back…** returns a job to an earlier stage, with a reason noted in the job; earlier runs stay in the stage log. **Run again** starts a new job with the same stages and samples, linked to the original (`rerun-of`). Signed jobs can't be sent back, but can be run again. The sample vault has a Plasmid prep workflow and a job in progress.
- **Reproducible analyses**:
  - **Environment saved:** when a cell runs, the environment's full package list and Python version are saved next to the note (`attachments/environment-<env>.txt`).
  - **Changed inputs flagged:** outputs whose input files have changed since are flagged, and so are the cells after them.
  - **↻ Reproduce:** rebuilds the recorded environment and reruns the cells in a fresh Python. It reports which outputs are the same and which parts differ: text, figures and tables, byte for byte. It never edits the note, so signed records can be checked too.
- **Python package `prem-notebook`** (`import prem`): write to the notebook from scripts, Jupyter and Python cells.
  - `entry.attach(fig)` saves a matplotlib figure, a DataFrame or any file next to the note and adds it to the note.
  - `entry.record("Colonies", 84)` fills in the Results table, and `entry.tables()` reads every table back as DataFrames.
  - It works with a vault folder or a team server. On a server, your permissions apply and changes are recorded under your name. In a local vault, Prem records them as changes made outside Prem.
  - Signed notes are never changed. It has no required dependencies, works on Python 3.9 and later, and is released to PyPI from GitHub with trusted publishing. See `docs/python.md`.
- **A warmer look**: warm paper backgrounds and soft charcoal in dark mode, with the logo's teal as the accent, chosen so text and buttons meet WCAG AA contrast. Headings are set in Source Serif 4 and the interface in Inter, both open fonts bundled with the app, so Prem looks the same on every computer. **Settings → Font in notes** switches the text you write to the serif. PDF exports use the serif for headings, and the website matches the app.
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
