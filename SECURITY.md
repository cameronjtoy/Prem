# Security policy

Prem stores research records, often on shared lab servers, so we take security reports seriously.

## Reporting a vulnerability
Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue.

Include what you found, how to reproduce it, and what an attacker could do with it. We'll acknowledge the report, keep you updated while we work on a fix, and credit you when it's released unless you'd rather stay anonymous.

## What's in scope
- The desktop app, including anything that could read or write files outside a vault, run code, or leak data between vaults.
- The team server: authentication, per-folder permissions, and anything that lets a user read, change or learn about notes they shouldn't.
- Record integrity: anything that could change a signed or locked entry without it showing up.

## Supported versions
Prem is pre-release. Fixes go into `main` and the next release.
