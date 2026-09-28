---
type: runbook
owner: Cameron
last-reviewed: 2026-09-28
tags: [runbook, prem, deploy]
---

# Upgrade the Prem server

## Purpose
Ship a new version of the Prem server with a quick way back if it misbehaves.

## When to use
- New changes are merged into Prem's `main` branch and the tests pass

## Prerequisites
- [ ] Tests pass on your laptop: `npm test`
- [ ] Backups are current (see [[Back up and restore the vault]])
- [ ] A quiet moment: restarting drops live connections for a few seconds; apps reconnect by themselves

## Steps
1. [ ] Build the new version on your laptop:
   ```bash
   git pull
   ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
   npm test
   npm run server:build
   scp out/server/index.js you@prem.example.com:/tmp/prem-server.js
   ```
2. [ ] On the VM, keep the current version, then swap in the new one:
   ```bash
   sudo cp /opt/prem/server.js /opt/prem/server.prev.js
   sudo install -m 644 /tmp/prem-server.js /opt/prem/server.js
   sudo systemctl restart prem
   ```
3. [ ] Update your desktop app too: `git pull && npm ci`, then start it again (see [[Run the desktop app]]).

## Verification
- `curl https://prem.example.com/api/health` returns `{"ok":true}`
- `journalctl -u prem -n 20` shows the `Prem server hosting …` line and no errors
- In the app, open a note, edit it, and see it save; the log shows `<you> saved <note>.md`

## Rollback
1. [ ] Put the previous version back and restart:
   ```bash
   sudo install -m 644 /opt/prem/server.prev.js /opt/prem/server.js
   sudo systemctl restart prem
   ```
2. [ ] Check health again, then look into what broke before retrying

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- [[Deploy the Prem server]]
- [[Prem server is down]]
