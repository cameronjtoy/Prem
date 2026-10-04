# Design system

How Prem's interface looks and behaves, and the pieces to build new screens from. Everything here exists in the code today. The colours, fonts and sizes are CSS variables (tokens) in [`app.css`](../src/renderer/src/styles/app.css); the editor's styles are in [`editor.css`](../src/renderer/src/styles/editor.css) and its CodeMirror theme in [`theme.ts`](../src/renderer/src/components/Editor/extensions/theme.ts).

[`tokens.test.ts`](../src/docs/tokens.test.ts) keeps this page and the stylesheets in step. It fails if a token is missing from the dark theme or from this page, if text colours drop below the contrast rules below, or if a colour is written directly into a stylesheet instead of using a token.

## Principles

- **The notebook comes first.** The interface is quiet: warm paper neutrals, one accent, few borders. Notes get the space and the strongest type.
- **Editorial, not technical.** Serif headings and a readable measure (760px by default) make a record feel like a notebook page, not a form.
- **Colour is never the only signal.** Every status also has words or an icon: "Signed", "Code changed since this output", a ✓ on a completed stage.
- **Works for everyone.** Light and dark, any text size from the Settings screen, keyboard only, and with reduced motion.
- **Same on every platform.** Inter is bundled, so the app looks the same on macOS, Windows and Linux.

## Colour

Use tokens only: `color: var(--text-muted)`, never a hex value. A colour that must stay fixed (a figure drawn for a white page) is the only exception, and its line in the stylesheet is preceded by a `/* fixed: why */` comment.

Light is the `:root` block; dark redefines the same tokens under `@media (prefers-color-scheme: dark)`. The theme setting (system, light, dark) works through Electron's `nativeTheme`, so that media query always reflects the person's choice.

### Surfaces

| Token | Light | Dark | Use |
|---|---|---|---|
| `--bg` | `#faf9f5` | `#262624` | the page: editor, main views |
| `--bg-side` | `#f2f0e9` | `#1f1e1c` | sidebars: file list, links panel |
| `--bg-elevated` | `#ffffff` | `#302f2c` | things above the page: dialogs, popovers, cards, bars |
| `--bg-hover` | warm 6% tint | light 6% tint | hover on rows and quiet buttons |
| `--bg-active` | accent 13% | accent 16% | the selected row, the open note in the tree |
| `--border` | `#e5e2d9` | `#3d3c38` | hairlines between areas, input and card outlines |
| `--code-bg` | `#f0eee6` | `#2d2c29` | inline code and code blocks |
| `--overlay` | dark 30% | black 45% | behind dialogs |
| `--selection` | accent 22% | accent 28% | selected text |
| `--search-match` | amber 35% | amber 30% | search hits in the editor and results |

### Text

| Token | Light | Dark | Use |
|---|---|---|---|
| `--text` | `#2e2c27` | `#e9e6dd` | body text |
| `--text-strong` | `#1a1915` | `#f7f5ef` | headings, titles, the selected item |
| `--text-muted` | `#6e6a5f` | `#a7a398` | secondary text that still informs: hints, empty states, paths, labels, quiet buttons |
| `--text-faint` | `#8f8a7e` | `#7c7970` | decoration and detail repeated elsewhere: chevrons, list marks, finished tasks, disabled things. Never the only place information appears |

### Accent

The accent is the teal of the logo (`#89a5ab`), deepened in light mode so it reads as text.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--accent` | `#4c6f77` | `#9dbcc2` | primary buttons, links, focus rings, the current item |
| `--accent-hover` | `#3f5e65` | `#b4cfd4` | hover on accent things |
| `--accent-soft` | accent 14% | accent 16% | info banners, highlighted chips, your own cards on the board |
| `--on-accent` | `#ffffff` | `#1a1d1d` | text and icons on `--accent` |

### Status

| Token | Light | Dark | Use |
|---|---|---|---|
| `--danger` | `#b5412f` | `#e8806c` | errors, destructive actions, removed lines' text |
| `--success` | `#3a7649` | `#8dc49a` | signed, complete, a check that passed |
| `--success-soft` | success 8% | success 8% | the background of a complete run or signed record |
| `--success-border` | success 40% | success 40% | its outline |
| `--warning-bg` | `#fbf1d9` | `#3a3322` | warning banners: settings problems, a damaged history |
| `--warning-border` | `#e8d29a` | `#6b5a2b` | their border |
| `--error-bg` | `#fbeae5` | `#3d2622` | error banners and error output |
| `--error-border` | `#ecbcb1` | `#6e3a32` | their border |
| `--added` | success 16% | success 16% | added lines in history diffs |
| `--removed` | danger 14% | danger 16% | removed lines in history diffs |

### Code and graph

| Token | Light | Dark | Use |
|---|---|---|---|
| `--syn-keyword` | `#8a4d8c` | `#d19ad3` | keywords in code blocks and cells |
| `--syn-string` | `#4f7a3a` | `#a7c98a` | strings |
| `--syn-comment` | `#9a9586` | `#85817a` | comments |
| `--syn-number` | `#a5612a` | `#e0a46e` | numbers |
| `--syn-function` | `#3d6a8a` | `#8fb8d6` | function names |
| `--syn-type` | `#946c1c` | `#e2c27f` | types and classes |
| `--syn-property` | `#b0523d` | `#e8957f` | properties, frontmatter keys |
| `--syn-math` | `#2f7570` | `#7fc7c0` | math source |
| `--graph-node` | `#8d887b` | `#a19d93` | notes in the graph |
| `--graph-unresolved` | `#d4d0c4` | `#57554f` | links to notes that don't exist yet |
| `--graph-link` | warm 16% | light 16% | the lines between them |

### Contrast rules

Checked by the test for both themes, on `--bg`, `--bg-side` and `--bg-elevated`:

- `--text`, `--text-strong`, `--text-muted`, `--accent`, `--danger` and `--success`: at least **4.5:1** (WCAG AA for normal text).
- `--on-accent` on `--accent`: at least 4.5:1.
- `--text-faint`: at least **3:1**, the rule for icons and other non-text marks. That is why it is not for information.

## Type

| Token | Value | Use |
|---|---|---|
| `--font-text` | Inter (bundled), then the system font | the whole interface, and notes by default |
| `--font-serif` | Source Serif 4 (bundled), then Iowan Old Style, Georgia | note headings, the welcome title, empty states, PDF headings |
| `--font-mono` | SF Mono, the system monospace, JetBrains Mono | code, cell output, keys, paths in settings |
| `--font-note` | `--font-text`, or `--font-serif` | the note body; **Settings → Appearance → Note font** |

Sizes in use (px). Pick from these rather than adding new ones:

| Size | Use |
|---|---|
| 11 | badges, chip labels, keyboard keys |
| 12 | hints, metadata, secondary lines in lists |
| 13 | the interface: toolbars, buttons, the file list, bars, settings |
| 14 | body text outside the editor (the base size) |
| 15 | dialog titles |
| 17 | the Settings title |
| 32 | the welcome title (serif) |
| `--editor-font-size` | the note, 16 by default; **Settings → Appearance → Text size** |

Weights: 400 for text, 500 for buttons and labels, 600 for titles. Headings in notes use the serif with slightly tighter letter spacing; body line height in the editor is 1.7.

## Space, shape and depth

- **Spacing** steps by 2px for tight controls and 4px elsewhere: 2, 4, 6, 8, 10, 12, 16, 24. Toolbars are 8px horizontal; dialogs 16px inside.
- **Corner radius:** 4 for small things inside others (code, images), 6 for buttons and inputs, 8 for cards and bars, 10 for dialogs and popovers, a pill (999px) for chips and badges. Some older controls use 5 or 7; use the nearest of the scale for anything new.
- **Depth:** `--shadow` for things that float (dialogs, popovers, a dragged card), `--shadow-small` for a lifted control (the selected segment). Everything else is flat, separated by `--border`.
- **Width:** notes are `--editor-width` wide: 760px, or wider from **Settings → Appearance → Editor width**.

## Components

Class names are in `app.css` unless noted. Reuse them before writing new CSS.

### Buttons

| Class | Looks like | Use |
|---|---|---|
| `primary-button` | solid accent, `--on-accent` text, radius 6 | the one main action in a dialog or empty state: **Install**, **Open GitHub issue** |
| `text-button` | no background, muted text, hover tint | secondary actions: **Cancel**, **Copy**, **Show logs folder** |
| `icon-button` | a 16px icon with 5px padding | toolbar actions; always with `aria-label` and a `title` that names the shortcut |
| `segmented` | a row of buttons on a tinted track; `.on` is raised | choosing one of a few views or values: Note / Graph / Board |

All buttons: hover changes the background, `:focus-visible` shows the accent ring, and `:disabled` dims to half opacity with a normal cursor. A disabled button gets a `title` saying why ("Signed notes can't be run").

Bars above the editor (`run-bar`, `record-bar` in `editor.css`) have their own button styles: `run-primary` and `record-primary` are the bar's main action.

### Inputs

`text-input` (dialogs), `setting-input` (Settings), `search-input` (search and palette) and `name-input` (naming in the file tree). They have a `--border` outline that turns `--accent` on focus; text fields show focus with the border, not the ring.

### Toolbars and panes

`main-toolbar` runs across the top; each sidebar has a `pane-toolbar` with its title and icon buttons. `toolbar-spacer` pushes what follows to the right. Show or hide toggles show their state with `aria-pressed`.

### Bars

One bar sits above a note when it is a record, and offers the next step: the run bar (protocol, run, workflow, job) and the record bar (signing). A bar is an `--bg-elevated` card with a hairline border; complete or signed turns it `--success-soft` with `--success-border`. Say the state in words ("Stage 2 of 3: Miniprep", "Signed by alice").

### Banners

`banner` plus one of `info`, `warning` or `error`, across the top of the area it is about. Use `role="alert"` when it appears because of something the person just did. Keep it to one sentence and at most two buttons.

- **info** (`--accent-soft`): an update is ready.
- **warning** (`--warning-bg`): settings.json has a problem; this note's history can't be read.
- **error** (`--error-bg`): something failed and needs attention.

### Dialogs

`modal-backdrop` (fills the window with `--overlay`, closes on click) holding a `modal` (`--bg-elevated`, radius 10, `--shadow`, 460px or 90% of the window). Every dialog:

- has `role="dialog"` and an `aria-label`, and an `h2` title;
- puts focus inside when it opens (on the safest button for anything destructive);
- closes with Escape and with a Cancel or Close button;
- shows exactly what will happen: the report text, the packages to install, the code to run.

Examples: `ReportProblem.tsx`, `ApproveRun.tsx`, the history and search dialogs.

### Cards, chips and badges

- `board-card`: a job on the board, an `--bg-elevated` button-like card with radius 8. Your own jobs have an `--accent` stripe on the left. Each card has a ⋯ menu, so everything you can do by dragging can also be done with the keyboard.
- `board-chip`: a pill with a person's name or a status.
- `badge`: a small pill with a count, as on the My tasks button. The button it sits on says the count in its `aria-label` ("My tasks, 3 waiting").

### Well grid

[`BoxGrid.tsx`](../src/renderer/src/components/Samples/BoxGrid.tsx) draws a storage box: column numbers across the top, row letters down the side, and a round `well` per place. A filled well is `--accent-soft` with an `--accent` edge and shows the sample's number; two samples in one place are `--error-bg` with a `--danger` edge; the selected well has the focus ring, and in a picker the sample's current place has a dashed edge. Each well's `aria-label` says the place and what's in it ("A1: S-0001, plasmid DNA"). The grid is one tab stop: the arrow keys move between wells and Enter opens one. In a picker, taken wells are `aria-disabled` rather than disabled, so the keyboard can still pass over them and choosing one says why it can't be used.

### Empty states and hints

`empty` (with `.centered` for a whole view) and `hint` use `--text-muted`. Say what's missing and how to fill it: "Nothing is waiting on you."

## Icons

Icons are in [`icons.tsx`](../src/renderer/src/components/icons.tsx): 24-unit SVGs drawn at 16px, no fill, a 1.8 stroke in `currentColor` with round caps and joins, `aria-hidden` by default. To add one, write it with the shared `base(props)` the others use, keep it to a few strokes, and check it at 16px in both themes. An icon-only button needs an `aria-label`.

## Accessibility

- **Keyboard:** everything works without a mouse. A grid of many small buttons (the well grid) is one tab stop, moved around with the arrow keys. Commands have shortcuts listed in the palette and the menu (see [`commands.ts`](../src/shared/commands.ts)); anything you can drag also has a menu item.
- **Focus:** one ring for everything you can tab to: a 2px `--accent` outline, 2px out. Don't remove it; text fields are the exception, with their accent border.
- **Targets:** at least 24×24px for anything clickable.
- **Labels:** icon-only buttons have an `aria-label`; toggles use `aria-pressed`; dialogs are labelled; status changes that matter use `role="alert"` or `role="status"`.
- **Motion:** keep it short and functional. Under `prefers-reduced-motion`, transitions and animations are switched off globally.
- **Text size:** layouts must survive the largest text size in Settings and the window at its smallest, 800px wide.

## Settings that change the look

[`SettingsContext.tsx`](../src/renderer/src/state/SettingsContext.tsx) turns **Settings → Appearance** into tokens on the root element: `--editor-width`, `--editor-font-size` and `--font-note`. The theme setting goes through main to `nativeTheme`. A new appearance setting should do the same: add it to the [settings schema](../src/shared/settings/schema.ts), set a token, and use the token in CSS.

## The website

The site ([`site/style.css`](../site/style.css)) uses the same palette and fonts under shorter names: `--bg-soft` is `--bg-side`, `--muted` is `--text-muted`, `--accent-text` is `--on-accent`. Change both when a colour changes.

## Adding or changing a token

1. Add it to both the `:root` block and the dark block in `app.css`.
2. Add a row to the right table on this page, with its use.
3. Run `npx vitest run src/docs` to check both themes and contrast.
4. If the site uses it, update `site/style.css`.
