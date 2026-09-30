---
type: runbook
owner: Cameron
last-reviewed: 2026-09-28
tags: [runbook, prem, incident]
---

# Prem server is down

## Purpose
Get the team vault back when the app can't reach it or can't save.

## When to use
- The app shows `Can't reach the server at https://prem.example.com`
- A note's status says it couldn't save
- The app says `Missing or invalid access token` or `doesn't have permission to …`

## Prerequisites
- [ ] SSH access to the Prem VM with sudo

## Steps
1. [ ] **Don't close notes with unsaved edits.** The app keeps them in the editor. Once the server is back, press ⌘S to save.
2. [ ] Check the server from outside:
   ```bash
   curl -sS https://prem.example.com/api/health
   ```
   - `{"ok":true}`: the server is fine; skip to step 5
   - Connection or certificate error: continue
3. [ ] Check the service and its recent logs:
   ```bash
   sudo systemctl status prem
   journalctl -u prem -n 100 --no-pager
   ```
4. [ ] Match the error and fix it:
   | Log or symptom | Cause | Fix |
   | --- | --- | --- |
   | `Invalid server config: …` or a JSON syntax error | Typo in the config | Fix `/etc/prem/prem-server.json` (the message names the field), then `sudo systemctl restart prem` |
   | `listen EADDRINUSE` | Something else is on port 4747 | `sudo ss -ltnp 'sport = :4747'`, stop it, restart prem |
   | `[watcher] … ENOSPC` (notes save, but others don't see changes live) | Large vault | `echo fs.inotify.max_user_watches=524288 \| sudo tee /etc/sysctl.d/90-prem.conf && sudo sysctl --system`, then restart |
   | `ENOENT` / `Not a folder` for the vault | Vault path wrong or missing | Check `vault` in the config and that `/var/lib/prem/vault` exists and is owned by `prem` |
   | Service running, health fails | Caddy or DNS | `sudo systemctl status caddy`, `journalctl -u caddy -n 50`, `dig prem.example.com` |
   | `Server error (ref …)` in the app | A bug | Search the log for that ref; it has the full error |
5. [ ] If only one person is affected:
   - `Missing or invalid access token`: their token is wrong or was removed; issue a new one with [[Add or remove a team member]]
   - `doesn't have permission to …`: working as configured; change their access if it's wrong
6. [ ] Once it's healthy, ask everyone to press ⌘S on any note showing an error

## Verification
- `curl https://prem.example.com/api/health` returns `{"ok":true}`
- `journalctl -u prem -f` shows saves coming in again

## Rollback
1. [ ] If this started after an upgrade, roll back with [[Upgrade the Prem server]]
2. [ ] If the vault is damaged, restore it with [[Back up and restore the vault]]

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- [[Prem server config]]
- [[Deploy the Prem server]]
