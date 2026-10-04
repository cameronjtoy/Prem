# Contributing to Prem

By taking part you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md).

Thanks for helping build Prem, an open-source lab notebook that runs on your own machines. Bug reports, feature ideas and pull requests are all welcome.

## Getting set up
You need Node.js 20 or newer and git.

```bash
git clone https://github.com/cameronjtoy/Prem.git
cd Prem
npm ci
npm run dev
```

Open `examples/sample-vault/` from the welcome screen to try things out. To work on the team server, see [Hosting a team vault](README.md#hosting-a-team-vault).

## Before you open a pull request
Run the same checks CI runs:

```bash
npm run format:check   # or `npm run format` to fix
npm run lint
npm run typecheck
npm test
npm run build
npm run server:build
npm run e2e            # end-to-end tests of the built app; on Linux without a display: xvfb-run -a npm run e2e
```

Formatting is [Prettier](https://prettier.io) and linting is [oxlint](https://oxc.rs); both read their settings from the repo (`.prettierrc.json`, `.oxlintrc.json`), and `.editorconfig` keeps editors consistent. Most editors can format on save with the Prettier extension. Use the Node version in `.nvmrc` (`nvm use`). Commits that only reformat code are listed in `.git-blame-ignore-revs`; run `git config blame.ignoreRevsFile .git-blame-ignore-revs` once so `git blame` skips them (GitHub does this automatically).

We use oxlint rather than ESLint because the project is on TypeScript 7, which the ESLint TypeScript plugin doesn't support yet. A few React rules are turned off in `.oxlintrc.json` because they flag patterns this code uses on purpose, such as keeping the latest callback in a ref so the editor isn't recreated on every render; `react-hooks/exhaustive-deps` stays on.

Also try your change in the app itself. Unit tests cover the shared logic, but most bugs show up in the editor.

The end-to-end tests in `e2e/` drive the built app with [Playwright](https://playwright.dev): each test gets a fresh copy of the example vault and its own settings, and `team.spec.ts` runs the real server with two people. They take about 20 seconds. When you add a feature people use through the app, add a test there; `e2e/fixtures.ts` has helpers to open notes, rename, and answer save dialogs. On failure CI keeps a trace you can open with `npx playwright show-trace`.

## How changes are made
- Work on a branch and open a pull request against `main`. `main` is protected, and every change goes through a pull request with passing CI.
- Keep each pull request to one change, and say in the description what changed, why, and how you tested it.
- Add or update tests for logic in `src/shared/` and `src/server/`. Keep that code free of Electron and React so it stays easy to test.
- Match the style of the code around your change: naming, comment density and structure. Comments explain *why*, not *what*.
- Write commit messages that say what changed and why, in plain sentences.

## Where things live
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). In short: `src/shared` is plain TypeScript used everywhere, `src/main` is the Electron main process and the vault layer, `src/renderer` is the React app, and `src/server` is the team server.

## Notebook data is sensitive
Lab notebooks hold research data. Changes that touch storage, the team server, permissions or signing need extra care:
- Never write outside the vault.
- Never lose a user's edits.
- Never let a user see or change something their permissions don't allow.

If you're unsure, ask in the pull request.

## Making a release
Maintainers release from `main`:

1. Set `version` in `package.json` and rename the `[Unreleased]` heading in `CHANGELOG.md` to `[x.y.z] - <date>`, in one pull request.
2. After it merges, tag the merge commit: `git tag v0.1.0 && git push origin v0.1.0`. Use a suffix such as `v0.1.0-rc.1` for a test build; it becomes a pre-release and doesn't move the Docker `latest` tag.
3. The [release workflow](.github/workflows/release.yml) builds the installers, the server file and the Docker image, and opens a **draft** release with checksums and the changelog section as notes.
4. Install at least one build, then publish the draft.

The Python package (`python/`) is released separately. Set `__version__` in `python/src/prem/__init__.py`, then publish a GitHub release tagged `py-v<version>`. The [Python release workflow](.github/workflows/python-release.yml) uploads it to PyPI through trusted publishing; the one-time PyPI setup is in [`docs/python.md`](docs/python.md#publishing-the-package-maintainers).

To try packaging locally, `npm run package:dir` builds an unpacked app in `dist/` for your platform.

### Turning on signing and auto-update
Installers are unsigned until these repository secrets exist (Settings → Secrets and variables → Actions). Nothing else needs changing: `electron-builder.config.cjs` and the release workflow switch signing on when they find them.

| Secret | What it is |
|---|---|
| `CSC_LINK`, `CSC_KEY_PASSWORD` | The macOS Developer ID Application certificate, exported as a base64 `.p12`, and its password |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` | For notarization: the Apple ID, an app-specific password for it, and the team ID |
| `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` | The Windows code-signing certificate, as a base64 `.pfx`, and its password |

Signed builds update themselves: once a day they check this repository's releases, download a new version in the background and offer to restart (`src/main/updates.ts`). Linux AppImages do the same without signing. Unsigned macOS and Windows builds never update themselves, and **Settings → Updates** turns checking off. A draft release isn't seen by installed copies until it's published.

## The website
The site at https://cameronjtoy.github.io/Prem/ is built from `site/` and the guides in `docs/` by `npm run site`, and published from `main` by [the website workflow](.github/workflows/site.yml). Pages share `site/layout.html`; a guide in `docs/` appears on the site once it's listed in `DOCS` in `scripts/build-site.mjs`. Open `_site/index.html` in a browser to preview.

## Reporting security issues
Please don't open a public issue for security problems. See [SECURITY.md](SECURITY.md).

## License
By contributing, you agree that your contributions are licensed under the [Apache License 2.0](LICENSE).
