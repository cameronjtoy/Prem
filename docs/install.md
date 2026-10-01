# Installing Prem

Download the installer for your computer from the [latest release](https://github.com/cameronjtoy/Prem/releases/latest).

| Computer | File |
|---|---|
| Mac with Apple silicon (M1 or later) | `Prem-<version>-mac-arm64.dmg` |
| Mac with an Intel processor | `Prem-<version>-mac-x64.dmg` |
| Windows 10 or 11 | `Prem-<version>-win-x64.exe` |
| Linux (any distribution) | `Prem-<version>-linux-x86_64.AppImage` |
| Debian or Ubuntu | `Prem-<version>-linux-amd64.deb` |

Not sure which Mac you have? Open the Apple menu and choose **About This Mac**. "Chip: Apple M…" means Apple silicon.

The release also lists a `SHA256SUMS.txt` file. To check a download wasn't corrupted or altered, compare its checksum with the one listed there:

```bash
shasum -a 256 Prem-0.1.0-mac-arm64.dmg      # macOS
certutil -hashfile Prem-0.1.0-win-x64.exe SHA256   # Windows
sha256sum Prem-0.1.0-linux-x86_64.AppImage  # Linux
```

## Why your computer warns about Prem

Prem's installers are **not signed yet**. Signing costs a yearly fee for macOS and Windows, and it is planned before the public launch. Until then, macOS and Windows show a warning the first time you open Prem. The steps below get past it once; after that Prem opens normally.

If your lab's IT policy doesn't allow unsigned apps, ask them to review the source on GitHub, or run Prem from source (see the README).

## macOS

1. Open the `.dmg` file and drag **Prem** into **Applications**.
2. Open Prem from Applications. macOS says it "cannot verify that Prem is free of malware" (or "can't be opened because Apple cannot check it"). Choose **Done** or **Cancel**, not Move to Bin.
3. Open **System Settings → Privacy & Security**. Scroll down to the message about Prem and choose **Open Anyway**. Enter your password if asked.
4. Choose **Open** in the dialog that follows.

On macOS 14 or earlier you can instead Control-click Prem in Applications, choose **Open**, then **Open** again.

## Windows

1. Run the `.exe` installer.
2. If Windows shows "Windows protected your PC", choose **More info**, then **Run anyway**.
3. Choose where to install Prem. It installs for your user only, so you don't need administrator rights.

Prem appears in the Start menu and on the desktop. Uninstall it from **Settings → Apps**.

## Linux

**AppImage** (any distribution):

```bash
chmod +x Prem-0.1.0-linux-x86_64.AppImage
./Prem-0.1.0-linux-x86_64.AppImage
```

If it says FUSE is missing, install `libfuse2` (Ubuntu 22.04 and later: `sudo apt install libfuse2t64` or `libfuse2`), or run it with `--appimage-extract-and-run`.

**Debian or Ubuntu**:

```bash
sudo apt install ./Prem-0.1.0-linux-amd64.deb
```

Prem appears in your applications menu under Science.

## Your first notebook

Choose **Open a folder as a vault** and pick an empty folder; Prem adds a `templates` folder with the lab templates. To look around first, download the [example vault](https://github.com/cameronjtoy/Prem/tree/main/examples/sample-vault) and open that instead.

## Updating

Prem doesn't update itself yet. Download the new version from the releases page and install it over the old one. Your notebooks are ordinary folders and are not touched by installing or uninstalling.

## The lab server

To share one notebook across a lab, someone runs the Prem server on a machine everyone can reach. Each release includes it in two forms.

**Docker** (recommended): the image is `ghcr.io/cameronjtoy/prem-server`. Make a folder for its data, such as `/srv/prem`, owned by user ID 1000 (the image runs as the unprivileged `node` user):

```bash
sudo mkdir -p /srv/prem/vault && sudo chown -R 1000:1000 /srv/prem

# Create a token for each person. Give them the token; put the printed entry in the config.
docker run --rm ghcr.io/cameronjtoy/prem-server token alice
```

Write `/srv/prem/prem-server.json`. Inside the container the vault is `/data/vault`, and the server must listen on `0.0.0.0`:

```json
{
  "vault": "/data/vault",
  "host": "0.0.0.0",
  "port": 4747,
  "users": [
    { "name": "alice", "tokenHash": "sha256:…", "access": { "": "write" } }
  ]
}
```

Then start it:

```bash
docker run -d --name prem --restart unless-stopped -p 4747:4747 -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server
```

**Single file**: `prem-server-<version>.js` needs only Node.js 20 or later:

```bash
node prem-server-v0.1.0.js token alice
node prem-server-v0.1.0.js --config prem-server.json
```

The server speaks plain HTTP. Put it behind HTTPS before people connect over a network you don't control; [docs/runbooks](runbooks/Deploying%20Prem.md) covers that, along with backups and adding people. In Prem, each person enters the server address and their token under **Or join your lab's shared vault** and chooses **Connect**.
