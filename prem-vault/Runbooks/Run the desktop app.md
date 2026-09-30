---
type: runbook
owner: Cameron
last-reviewed: 2026-09-28
tags: [runbook, prem, desktop]
---

# Run the desktop app

## Purpose
Get the Prem app running on your machine and join the team vault.

## When to use
- New team member setup
- After an upgrade (see [[Upgrade the Prem server]])

## Prerequisites
- [ ] Node.js 20 or newer and git
- [ ] The server address and your token (from whoever ran [[Add or remove a team member]])

## Steps
1. [ ] Get the code and install. There's no packaged installer yet, so the app runs from source.
   ```bash
   git clone https://github.com/cameronjtoy/Prem.git
   cd Prem
   npm ci
   ```
2. [ ] Start it:
   ```bash
   npm run dev
   ```
3. [ ] On the welcome screen, under **Or join your team's vault**, enter `https://prem.example.com` and your token, then **Connect**.
4. [ ] To switch to a local folder instead, use **Switch vault** (⌘O).

## Verification
- The file tree shows the team's folders, and hovering the vault name shows `<you> on https://prem.example.com`
- Edit a note: its status goes from "Saving" to "Saved"
- Quit and reopen the app: it reconnects without asking for the token again (macOS and Windows; on Linux this needs a keyring such as GNOME Keyring, otherwise you paste the token each time)

## Rollback
1. [ ] Nothing to undo; quitting the app leaves the vault as it is

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- If `npm run dev` fails with `Cannot read properties of undefined (reading 'whenReady')`, run `unset ELECTRON_RUN_AS_NODE` and try again
- [[Prem server is down]] if it can't connect
