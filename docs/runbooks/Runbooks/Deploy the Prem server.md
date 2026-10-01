---
type: runbook
owner: Cameron
last-reviewed: 2026-09-28
tags: [runbook, prem, deploy]
---

# Deploy the Prem server

## Purpose
Stand up a Prem team server on a Linux VM, served over HTTPS, so the team can share one vault.

## When to use
- First-time setup of a team vault
- Moving Prem to a new machine (restore the vault afterwards with [[Back up and restore the vault]])

## Prerequisites
- [ ] A Linux VM (Ubuntu 24.04 or similar) with SSH access and sudo
- [ ] A domain name, e.g. `prem.example.com`, with a DNS A record pointing at the VM
- [ ] Ports 80 and 443 open to the internet (Caddy needs both to get a certificate)
- [ ] Node.js 20 or newer on the VM: `node --version`
- [ ] Caddy installed on the VM: `caddy version`
- [ ] The Prem repo cloned on your laptop

## Steps
1. [ ] Build the server on your laptop. The output is one file with no dependencies.
   ```bash
   cd Prem
   git pull
   ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci
   npm run server:build
   ls -lh out/server/index.js
   ```
   `ELECTRON_SKIP_BINARY_DOWNLOAD=1` skips the Electron download, which the server doesn't need.
2. [ ] Copy it to the VM.
   ```bash
   scp out/server/index.js you@prem.example.com:/tmp/prem-server.js
   ```
3. [ ] On the VM, create a service user and the folders.
   ```bash
   sudo useradd --system --home /var/lib/prem --shell /usr/sbin/nologin prem
   sudo mkdir -p /opt/prem /etc/prem /var/lib/prem/vault
   sudo install -m 644 /tmp/prem-server.js /opt/prem/server.js
   sudo chown -R prem:prem /var/lib/prem
   ```
4. [ ] Create your own token. Save the token in your password manager and keep the printed config entry for the next step.
   ```bash
   node /opt/prem/server.js token cameron
   ```
5. [ ] Write the config. Paste your entry into `users` and give yourself write access to everything.
   ```bash
   sudo nano /etc/prem/prem-server.json
   ```
   ```json
   {
     "vault": "/var/lib/prem/vault",
     "host": "127.0.0.1",
     "port": 4747,
     "users": [
       { "name": "cameron", "tokenHash": "sha256:…", "access": { "": "write" } }
     ]
   }
   ```
   Then lock it down so only the service can read it:
   ```bash
   sudo chown root:prem /etc/prem/prem-server.json
   sudo chmod 640 /etc/prem/prem-server.json
   ```
6. [ ] Create the systemd service. Check the Node path with `which node` and use that in `ExecStart`.
   ```bash
   sudo nano /etc/systemd/system/prem.service
   ```
   ```ini
   [Unit]
   Description=Prem team server
   After=network.target

   [Service]
   User=prem
   ExecStart=/usr/bin/node /opt/prem/server.js --config /etc/prem/prem-server.json
   Restart=on-failure

   [Install]
   WantedBy=multi-user.target
   ```
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable --now prem
   ```
7. [ ] Put Caddy in front for HTTPS. Add this to `/etc/caddy/Caddyfile`:
   ```
   prem.example.com {
       reverse_proxy 127.0.0.1:4747
   }
   ```
   ```bash
   sudo systemctl reload caddy
   ```
8. [ ] Join the vault from the desktop app with `https://prem.example.com` and your token. See [[Run the desktop app]].

## Verification
- `curl https://prem.example.com/api/health` returns `{"ok":true}`
- `journalctl -u prem -n 20` shows `Prem server hosting /var/lib/prem/vault at http://127.0.0.1:4747 for 1 user(s)`
- The app opens the vault and the file tree shows a `templates` folder (the server creates it on first start)
- Saving a note logs `cameron saved <note>.md` in `journalctl -u prem`

## Rollback
1. [ ] Stop and disable the service: `sudo systemctl disable --now prem`
2. [ ] Remove the `prem.example.com` block from the Caddyfile and `sudo systemctl reload caddy`
3. [ ] The vault in `/var/lib/prem/vault` is untouched; copy it off before deleting the VM

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | Cameron |  |
| Backup |  |  |

## Related
- [[Deploying Prem]]
- [[Prem server config]]
- [[Prem server is down]]
