---
type: runbook
owner: Cameron
last-reviewed: 2026-09-28
tags: [runbook, prem, access]
---

# Add or remove a team member

## Purpose
Give a person or a bot access to the team vault, change what they can see, or revoke it.

## When to use
- Someone joins, leaves, or changes team
- A token may have leaked (treat it as remove, then add with a new token)
- Setting up a read-only bot, e.g. a support agent that only needs runbooks

## Prerequisites
- [ ] SSH access to the Prem VM with sudo
- [ ] A secure way to send the token, e.g. a password manager share (never chat or email)

## Steps
### Add someone
1. [ ] Create their token on the VM:
   ```bash
   node /opt/prem/server.js token alice
   ```
2. [ ] Add the printed entry to `users` in `/etc/prem/prem-server.json` and set their access. Examples:
   | Who | `access` |
   | --- | --- |
   | Can edit everything | `{ "": "write" }` |
   | Reads everything, edits Runbooks | `{ "": "read", "Runbooks": "write" }` |
   | Everything except Finance | `{ "": "write", "Finance": "none" }` |
   | Support bot, runbooks only | `{ "Runbooks": "read" }` |
3. [ ] Restart so the server picks up the change. Open apps reconnect on their own within a few seconds.
   ```bash
   sudo systemctl restart prem
   ```
4. [ ] Send them the token and the server address, and point them to [[Run the desktop app]].

### Change someone's access
1. [ ] Edit their `access` in `/etc/prem/prem-server.json`
2. [ ] `sudo systemctl restart prem`

### Remove someone or revoke a token
1. [ ] Delete their entry from `users` in `/etc/prem/prem-server.json`
2. [ ] `sudo systemctl restart prem`

## Verification
- `journalctl -u prem -n 5` shows the new user count, e.g. `for 3 user(s)`
- A new user can join the vault from the app
- A removed user's app shows `Missing or invalid access token`
- For a scoped user, the file tree shows only their folders; restricted notes don't appear at all

## Rollback
1. [ ] Restore the previous `/etc/prem/prem-server.json` (keep a copy before editing: `sudo cp /etc/prem/prem-server.json /etc/prem/prem-server.json.bak`)
2. [ ] `sudo systemctl restart prem`

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- [[Prem server config]] for how permission rules are matched
- [[Deploying Prem]]
