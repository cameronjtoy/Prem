---
type: reference
owner: Cameron
last-reviewed: 2026-09-28
tags: [prem, deploy, start-here]
---

# Deploying Prem

How I run my own Prem: one small server holds the team vault, and everyone opens it from the desktop app with their own token.

## How the pieces fit
- **Team server**: a single Node file that serves one vault folder over HTTPS, behind Caddy. It checks each person's token and folder permissions. See [[Prem server config]].
- **Vault**: a plain folder of markdown on the server. No database, so backups are just files. See [[Back up and restore the vault]].
- **Desktop app**: each person runs it and joins the team vault. See [[Run the desktop app]].

## First-time setup, in order
1. [ ] [[Deploy the Prem server]]
2. [ ] [[Add or remove a team member]] for everyone who needs access
3. [ ] [[Back up and restore the vault]]: turn on backups before anyone relies on it
4. [ ] [[Run the desktop app]] and join the vault

## Ongoing
- Shipping a new version: [[Upgrade the Prem server]]
- Something's wrong: [[Prem server is down]]

## Where things live on the server
| What | Path |
| --- | --- |
| Server code | `/opt/prem/server.js` |
| Config (users, tokens, permissions) | `/etc/prem/prem-server.json` |
| Vault | `/var/lib/prem/vault` |
| Service | `prem.service` (systemd) |
| Logs | `journalctl -u prem` |
