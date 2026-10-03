---
type: job
workflow: "[[Plasmid prep]]"
workflow-version: 1
stage: Sequence check
assignee: alice
status: in progress
created: 2026-09-28 09:00
created-by: alice
finished:
tags: [job]
---

# Plasmid prep — job 2026-09-28 09:00

Following [[Plasmid prep]]. Start each stage's run from the bar above; completing a stage hands the job to the next stage's assignee.

## Samples
- [[S-0002]] (pUC19 in DH5α)
- [[S-0001]] (the plasmid DNA)

## Stages
| Stage | Protocol | Assignee | Outputs |
| --- | --- | --- | --- |
| Grow culture | [[Overnight culture]] | bob | Overnight culture |
| Miniprep | [[Plasmid miniprep]] | alice | Plasmid DNA, registered as a sample |
| Sequence check |  | alice | Sequencing result attached to the job |

## Stage log
| Stage | Run | By | Started | Completed |
| --- | --- | --- | --- | --- |
| Grow culture |   | bob | 2026-09-28 17:30 | 2026-09-29 09:15 |
| Miniprep | [[Plasmid miniprep run 2026-09-29 1410]] | alice | 2026-09-29 14:10 | 2026-09-29 15:02 |

## Notes
The culture was grown before Prem was set up, so its stage has no run.
