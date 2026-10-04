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

Signed versions of Prem update themselves. Once a day they look for a new release, download it in the background, and offer to restart. You can turn this off in **Settings → Updates**. Updating never touches your notes, and nothing about them is sent.

Until the installers are signed, download each new version from the releases page and install it over the old one. The Linux AppImage updates itself already. Your notebooks are ordinary folders and are not touched by installing or uninstalling.

## The lab server

To share one notebook across a lab, someone runs the Prem server on a machine everyone can reach. Each release includes it as a Docker image, `ghcr.io/cameronjtoy/prem-server`, and as a single file for Node.js 20 or later, `prem-server-<version>.js`. Setting up a lab takes one command:

```bash
docker run --rm -it -v /srv/prem:/data ghcr.io/cameronjtoy/prem-server \
  init --config /data/prem-server.json --vault /data/vault --host 0.0.0.0
```

It asks who is in the lab and prints a token for each person. [Running a lab server](lab-server.md) covers the rest: starting it, HTTPS, adding people, permissions and backups.

In Prem, each person enters the server address and their token under **Or join your lab's shared vault** and chooses **Connect**.
