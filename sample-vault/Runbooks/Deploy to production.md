---
type: runbook
owner: Platform team
last-reviewed: 2026-09-27
tags: [runbook, deploy]
---

# Deploy to production

## Purpose
Ship a tested release from `main` to production with no downtime.

## When to use
- A release has passed staging checks
- It is inside the deploy window (Mon–Thu, 10:00–16:00)

## Prerequisites
- [x] Release notes written
- [ ] Staging smoke tests are green
- [x] On-call engineer knows a deploy is happening

## Steps
1. [ ] Tag the release
   ```bash
   git tag -a v2.14.0 -m "Release 2.14.0"
   git push origin v2.14.0
   ```
2. [ ] Watch the pipeline until the canary is healthy
3. [ ] Promote the canary to 100%
   ```bash
   deployctl promote --env production --release v2.14.0
   ```

## Verification
- Error rate stays below **0.5%** for 15 minutes
- Checkout conversion doesn't drop (see [[Unit economics]])

## Rollback
1. [ ] Follow the [[Rollback procedure]]
2. [ ] Open an incident if customers were affected — see [[Incident response]]

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary | On-call engineer | `#oncall` |
| Backup | Platform lead | `#platform` |
