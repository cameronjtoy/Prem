---
type: runbook
owner: Cameron
last-reviewed: 2026-09-28
tags: [runbook, prem, backup]
---

# Back up and restore the vault

## Purpose
Keep a history of every note so nothing is lost to a bad edit, a deleted note or a dead VM.

## When to use
- Right after [[Deploy the Prem server]], before the team relies on it
- Someone deleted or overwrote a note and needs it back
- Moving Prem to a new VM

## Prerequisites
- [ ] SSH access to the Prem VM with sudo
- [ ] An empty **private** git repo to push backups to, and a deploy key for it with write access

## Steps
### Turn on hourly backups
1. [ ] Make the vault a git repo. Prem ignores files and folders starting with a dot, so `.git` never shows up in the app.
   ```bash
   cd /var/lib/prem/vault
   sudo -u prem git init
   sudo -u prem git config user.name "Prem backup"
   sudo -u prem git config user.email "prem@localhost"
   echo '.trash/' | sudo -u prem tee .gitignore
   sudo -u prem git remote add origin git@github.com:you/prem-vault-backup.git
   ```
2. [ ] Give the `prem` user the deploy key, and check it can reach GitHub:
   ```bash
   sudo -u prem mkdir -p /var/lib/prem/.ssh
   sudo install -o prem -m 600 deploy_key /var/lib/prem/.ssh/id_ed25519
   sudo -u prem ssh -T git@github.com
   ```
3. [ ] Add the backup script at `/opt/prem/backup.sh`:
   ```bash
   #!/bin/sh
   set -e
   cd /var/lib/prem/vault
   git add -A
   git commit -qm "Backup $(date -u +%Y-%m-%dT%H:%MZ)" || exit 0
   git push -q origin HEAD
   ```
   ```bash
   sudo chmod 755 /opt/prem/backup.sh
   ```
4. [ ] Run it every hour as the `prem` user:
   ```bash
   echo '0 * * * * prem /opt/prem/backup.sh' | sudo tee /etc/cron.d/prem-backup
   ```

### Get back a deleted note
Deleted notes go to `.trash` inside the vault, named with the time they were deleted.
1. [ ] Find it: `ls /var/lib/prem/vault/.trash`
2. [ ] Move it back (it appears in everyone's app straight away):
   ```bash
   sudo -u prem mv "/var/lib/prem/vault/.trash/<stamp> Note.md" "/var/lib/prem/vault/Runbooks/Note.md"
   ```

### Get back an older version of a note
1. [ ] Find the version: `sudo -u prem git -C /var/lib/prem/vault log --oneline -- "Runbooks/Note.md"`
2. [ ] Restore it: `sudo -u prem git -C /var/lib/prem/vault checkout <commit> -- "Runbooks/Note.md"`

Anyone with the note open gets the "keep mine or reload" prompt if they had unsaved edits; otherwise it just reloads.

### Restore the whole vault on a new VM
1. [ ] Follow [[Deploy the Prem server]] up to, but not including, `systemctl enable --now prem`
2. [ ] Clone the backup into place:
   ```bash
   sudo rm -rf /var/lib/prem/vault
   sudo -u prem git clone git@github.com:you/prem-vault-backup.git /var/lib/prem/vault
   ```
3. [ ] Start the server: `sudo systemctl enable --now prem`

## Verification
- `sudo -u prem git -C /var/lib/prem/vault log -1` shows a backup from the last hour
- The latest commit is visible in the backup repo on GitHub

## Rollback
1. [ ] Remove `/etc/cron.d/prem-backup` to stop backups; the vault itself is unaffected

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- [[Deploying Prem]]
- [[Prem server is down]]
