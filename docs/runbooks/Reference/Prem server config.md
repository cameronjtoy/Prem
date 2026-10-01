---
type: reference
owner: Cameron
last-reviewed: 2026-09-28
tags: [reference, prem]
---

# Prem server config

## Summary
Everything the Prem server reads from `/etc/prem/prem-server.json`, how permissions are matched, and the commands and endpoints it offers.

## Config fields
| Field | Default | Meaning |
| --- | --- | --- |
| `vault` | required | Folder to host. A relative path is resolved from the config file's folder. |
| `host` | `127.0.0.1` | Address to listen on. Keep it local when Caddy runs on the same machine. |
| `port` | `4747` | Port to listen on |
| `users[].name` | required | Shown in logs, e.g. `cameron saved Welcome.md` |
| `users[].tokenHash` | required | `sha256:` hash printed by the `token` command. The token itself is never stored. |
| `users[].access` | required | Folder → `none`, `read` or `write` |

## How permissions are matched
- The rule for the **deepest** folder containing a note wins: with `{ "": "read", "Runbooks": "write" }`, `Runbooks/Deploy.md` is writable and `Welcome.md` is read-only.
- `""` means the whole vault.
- Anything no rule covers is **hidden**: `{ "Runbooks": "read" }` sees only Runbooks.
- Matching ignores upper and lower case, so `finance/…` can't get around a rule on `Finance`.
- Moving or deleting a folder needs write access to everything inside it.
- Hidden notes never reach the app: not in the file tree, links, graph or live updates.
- Changes need `sudo systemctl restart prem`.

## Commands
| Command | What it does |
| --- | --- |
| `node /opt/prem/server.js --config <file>` | Start the server (default config file: `prem-server.json` in the current folder) |
| `node /opt/prem/server.js token <name>` | Create a token and print its config entry |
| `npm run server:build` | Build `out/server/index.js` from the repo |

## Endpoints
| Endpoint | Token needed | Use |
| --- | --- | --- |
| `GET /api/health` | No | Health checks, returns `{"ok":true}` |
| `GET /api/info` | Yes | Vault name, your user name and your access rules |
| `GET /api/entries`, `/api/files`, `/api/file` | Yes | List and read notes |
| `PUT /api/file`, `POST /api/folder`, `POST /api/rename`, `DELETE /api/file` | Yes | Save, create folders, move, delete |
| `GET /api/events` | Yes | Live change stream (server-sent events) |

## Proxy notes
- Caddy works as is: `reverse_proxy 127.0.0.1:4747`.
- With nginx, the live change stream needs buffering off. The server sends `X-Accel-Buffering: no`, which nginx respects, and pings every 25s, so the default 60s `proxy_read_timeout` is fine.
- The app only sends tokens over `https://`, except to `localhost`.

## See also
- [[Deploy the Prem server]]
- [[Add or remove a team member]]
- [[Deploying Prem]]
