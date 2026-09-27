---
type: runbook
owner: Operations
last-reviewed: 2026-09-27
tags: [runbook, incident]
---

# Incident response

## Purpose
Coordinate a fast, calm response when customers are affected.

## Steps
1. [ ] Declare the incident in `#incidents` and pick an incident lead
2. [ ] Set severity using the table below
3. [ ] Post a customer update within 30 minutes
4. [ ] If a deploy caused it, roll back first — see [[Deploy to production]]
5. [ ] Write a review within 5 working days

## Severity
| Level | Meaning | Update every |
| :--- | :--- | ---: |
| SEV1 | Most customers can't use the product | 30 min |
| SEV2 | A key feature is broken | 1 hour |
| SEV3 | Minor or cosmetic issue | Daily |

## Related
- [[Glossary]] for terms like *MTTR*
