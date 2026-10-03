# Running a lab server

The Prem server lets a whole lab share one notebook. It hosts a vault folder on a machine everyone can reach, checks each person's token, and applies per-folder permissions: members write their own notebooks, the PI reads everyone's, and protocols are shared. Changes appear in everyone's window as they're saved.

The server is a single program with no database. The vault stays an ordinary folder, so backing it up is copying a folder.

## What you need

- A machine that stays on: a lab workstation, a small cloud server or a department VM. Linux, macOS or Windows all work.
- Either **Docker**, or **Node.js 20** or later.
- A way for people to reach it over **HTTPS**. Prem refuses plain HTTP except to the same machine, so tokens are never sent in the clear. [Tailscale](#https-with-tailscale) is the simplest; [Caddy](#https-with-caddy) works for a public address.

## Set up the lab

`init` asks a few questions, creates the vault and its folders, and prints a token for each person.

**With Docker:**

```bash
sudo mkdir -p /srv/prem && sudo chown 1000:1000 /srv/prem
docker run --rm -it -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server \
  init --config /data/prem-server.json --vault /data/vault --host 0.0.0.0
```

**With Node.js**, using `prem-server-<version>.js` from the [latest release](https://github.com/cameronjtoy/Prem/releases/latest):

```bash
node prem-server.js init
```

It asks:

| Question | What to answer |
|---|---|
| Folder for the lab notebook | Where the vault lives. It's created if it doesn't exist. |
| Who runs the lab | The PI, or several people separated by commas. |
| Lab members | Everyone else, separated by commas. You can add people later. |
| Can members read each other's notebooks? | Yes for an open lab; no to keep each notebook between its owner and the PI. |
| Address to listen on | `127.0.0.1` behind Tailscale or Caddy on the same machine; `0.0.0.0` in Docker or to accept connections from the network. |
| Port | `4747` unless something else uses it. |

To set it up without questions, for example from a script, pass the answers as flags:

```bash
node prem-server.js init --pi "Pat Lee" --members "alice,bob" --vault /srv/prem/vault --private-notebooks
```

Each token is shown once and never stored, only its hash. Send each person theirs privately, for example in a direct message, not a shared channel.

## Start the server

```bash
# Docker: publish the port on this machine only, and put HTTPS in front
docker run -d --name prem --restart unless-stopped -p 127.0.0.1:4747:4747 \
  -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server

# Node.js
node prem-server.js --config prem-server.json
```

To keep it running across reboots without Docker, use a service. On Linux with systemd, save this as `/etc/systemd/system/prem.service`, then run `sudo systemctl enable --now prem`:

```ini
[Unit]
Description=Prem lab server
After=network-online.target

[Service]
User=prem
ExecStart=/usr/bin/node /opt/prem/prem-server.js --config /etc/prem/prem-server.json
ExecReload=/bin/kill -HUP $MAINPID
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## People and permissions

Each person has a role, which sets what they can do:

| Role | Can write | Can read |
|---|---|---|
| `pi` | Everything except other people's notebooks: protocols, samples, templates, their own notebook | Everything, including every notebook |
| `member` | Their own notebook (`Notebooks/<name>`) and `Samples` | Protocols, templates and the rest of the lab; other notebooks only if notebooks are shared |
| `viewer` | Nothing | The same as a member |

Manage people with these commands. With Docker, run them through `docker exec prem node /app/prem-server.js … --config /data/prem-server.json`.

```bash
node prem-server.js add carol                 # a member; prints their token
node prem-server.js add "Dr Ruiz" --role pi
node prem-server.js add auditor --role viewer
node prem-server.js token alice               # a new token for alice; her old one stops working
node prem-server.js remove bob                # bob's token stops working; his notebook stays
node prem-server.js list                      # who is on the server and what they can write
```

**Changes apply straight away.** The running server notices when the config file changes, so there's no restart and nobody is signed out. Anyone whose permissions changed, or whose token was replaced or removed, is reconnected with the new rules. If the file is ever invalid, for example after a typo while editing it by hand, the server logs why and keeps the previous settings. You can also ask for a reload with `kill -HUP <pid>`, or `docker kill -s HUP prem`.

### Editing permissions by hand

The config file, `prem-server.json`, lists each person's `access` as folders and levels: `none`, `read` or `write`. The rule for the deepest folder containing a file wins, and `""` means the whole vault. For example, to let alice also edit protocols:

```json
{ "name": "alice", "role": "member", "tokenHash": "sha256:…", "access": {
    "": "read", "Notebooks": "read", "Notebooks/alice": "write", "Samples": "write", "Protocols": "write" } }
```

Folders a person can't read are invisible to them: they don't appear in the file tree, search or links.

## HTTPS with Tailscale

[Tailscale](https://tailscale.com) gives every lab member's computer and the server a private network with HTTPS names, with nothing exposed to the internet. It's free for small teams.

1. Install Tailscale on the server and on each lab member's computer, and sign them in to the same tailnet.
2. In the Tailscale admin console, under **DNS**, turn on **MagicDNS** and **HTTPS certificates**.
3. On the server, with Prem listening on `127.0.0.1:4747`:

   ```bash
   sudo tailscale serve --bg 4747
   ```

4. The command prints the address, such as `https://lab-server.tail1234.ts.net`. That's the server address people enter in Prem.

## HTTPS with Caddy

If the server has a public DNS name, [Caddy](https://caddyserver.com) gets and renews a certificate by itself. Point the name at the server, open ports 80 and 443, and use this `Caddyfile`:

```
prem.your-lab.org {
	reverse_proxy 127.0.0.1:4747
}
```

The server address is then `https://prem.your-lab.org`. A public address can be reached by anyone, so keep tokens private and remove people promptly when they leave.

## Backups

Back up the **whole vault folder, including the hidden `.prem` folder inside it**. `.prem` holds every saved version of every entry, and every signature and witness. Without it you keep the entries but lose their history and records. Also back up `prem-server.json`, or be ready to issue new tokens.

Writes are atomic and the history is append-only, so copying the folder while the server runs is safe. For example, with [restic](https://restic.net) every night:

```bash
restic -r /mnt/backup/prem backup /srv/prem
```

To restore, stop the server, put the folder back, and start it again. Test a restore before you rely on it.

## Upgrading

- **Docker:** `docker pull ghcr.io/cameronjtoy/prem-server`, then remove and start the container again with the same command.
- **Node.js:** replace `prem-server.js` with the new release's file and restart the service.

Upgrade the server first, then the apps. The vault is plain files, so an upgrade never converts it.

## Troubleshooting

| Problem | What to check |
|---|---|
| "Team servers must use https://" | Use the Tailscale or Caddy address, not `http://`. Plain HTTP works only to the same machine. |
| "Missing or invalid access token" | The token was replaced or the person removed. Issue a new one with `token <name>`. |
| Someone can't see a folder | Run `list`, and check their `access` rules. The deepest matching folder wins. |
| Edits to the config don't apply | Look at the server log for "Kept the previous settings". The message says what's wrong with the file. |
| The server log | `docker logs prem`, or `journalctl -u prem` with systemd. |
| "10 sign-ins with an invalid token from …" in the log | Someone is using an old, mistyped or removed token, or a stranger is probing the server. Tokens can't be guessed, so nobody gets in this way. If it's someone in the lab, give them a new token with `prem-server token <name>`. |
