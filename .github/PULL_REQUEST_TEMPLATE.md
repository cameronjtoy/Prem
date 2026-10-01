## What changed and why

<!-- One change per pull request. Say what it does for the person using Prem, and why. Link the issue if there is one. -->

## How it was tested

<!-- `npm run format:check && npm run lint && npm run typecheck && npm test && npm run build` all pass, plus what you tried in the running app (and on a team vault, if the change touches storage, permissions or signing). -->

## Checklist

- [ ] Logic lives in `src/shared/` or `src/server/` with tests, not in React components or IPC handlers
- [ ] Changes to storage, permissions, history or signing keep the guarantees in [CONTRIBUTING.md](https://github.com/cameronjtoy/Prem/blob/main/CONTRIBUTING.md#notebook-data-is-sensitive)
- [ ] `CHANGELOG.md` has a line under **Unreleased** if users would notice the change
- [ ] Docs updated if behaviour or setup changed (`README.md`, `docs/`)
