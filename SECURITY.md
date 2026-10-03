# Security policy

Prem stores research records, often on shared lab servers, so we take security reports seriously.

## Reporting a vulnerability
Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. We'll acknowledge the report, keep you updated while we work on a fix, and credit you when it's released unless you'd rather stay anonymous.

## What's in scope
- The desktop app, including anything that could read or write files outside a vault, run code, or leak data between vaults.
- The team server: authentication, per-folder permissions, and anything that lets a user read, change or learn about notes they shouldn't.
- Record integrity: anything that could change a signed or locked entry without it showing up.

## How Prem protects you
- **The app:** windows run sandboxed, with context isolation and a Content-Security-Policy. Links open only as web or mail links. Every file path is checked to stay inside the vault, symlinks included.
- **Running code:** Python code and package installs run only after you approve them on your computer, and you're asked again when they change. See [What Prem asks before running](docs/analysis.md#what-prem-asks-before-running).
- **The team server:** each person has a random 256-bit token, and only its SHA-256 is stored. Permissions are per folder, and who made each change comes from the token, never from the request. The app and the Python package refuse plain `http://` except on the same computer.
- **Records:** history is hash-chained, so changes to it can be detected. Signatures are attestations tied to who signed in, not cryptographic signatures yet. Someone with write access to the vault folder itself could rewrite history consistently. Prem is not certified for 21 CFR Part 11.

## Supported versions
Prem is pre-release. Fixes go into `main` and the next release.
