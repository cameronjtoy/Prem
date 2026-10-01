---
type: runbook
owner: Cameron
last-reviewed: 2026-10-01
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
Changes to the config apply within a second, without a restart. Open apps of anyone affected reconnect with their new access on their own.

### Add someone
1. [ ] Add them on the VM. The role sets their access: `member` (default) writes their own notebook and samples, `pi` edits shared material and reads every notebook, `viewer` only reads.
   ```bash
   sudo -u prem node /opt/prem/server.js add alice --config /etc/prem/prem-server.json
   ```
2. [ ] Send them the printed token and the server address, and point them to [[Run the desktop app]].

### Change someone's access
1. [ ] Keep a copy: `sudo cp /etc/prem/prem-server.json /etc/prem/prem-server.json.bak`
2. [ ] Edit their `access` in `/etc/prem/prem-server.json`. Examples:
   | Who | `access` |
   | --- | --- |
   | Can edit everything | `{ "": "write" }` |
   | Reads everything, edits Protocols | `{ "": "read", "Protocols": "write" }` |
   | Everything except Finance | `{ "": "write", "Finance": "none" }` |
   | Instrument bot, one folder only | `{ "Instruments/Plate reader": "write" }` |

### Replace a lost or leaked token
1. [ ] `sudo -u prem node /opt/prem/server.js token alice --config /etc/prem/prem-server.json`; the old token stops working at once

### Remove someone
1. [ ] `sudo -u prem node /opt/prem/server.js remove alice --config /etc/prem/prem-server.json`; their notebook stays in the vault

## Verification
- `journalctl -u prem -n 5` shows `Reloaded people and permissions` with the new count
- `node /opt/prem/server.js list --config /etc/prem/prem-server.json` shows who can write what
- A new user can join the vault from the app
- A removed user's app shows `Missing or invalid access token`
- For a scoped user, the file tree shows only their folders; restricted notes don't appear at all

## Rollback
1. [ ] Restore the copy: `sudo cp /etc/prem/prem-server.json.bak /etc/prem/prem-server.json`. It applies on its own.
2. [ ] If the log says `Kept the previous settings`, the file has a mistake; the message says what it is

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- [[Prem server config]] for how permission rules are matched
- [[Deploying Prem]]
