---
type: workflow
version: 1
author: alice
tags: [workflow]
---

# Plasmid prep

## Purpose
From a glycerol stock to sequence-verified plasmid DNA, registered as a sample.

## Stages
Each row is one stage, in order. Link a protocol to run it from the job, or leave it blank for a step done without one.

| Stage | Protocol | Assignee | Outputs |
| --- | --- | --- | --- |
| Grow culture | [[Overnight culture]] | bob | Overnight culture |
| Miniprep | [[Plasmid miniprep]] | alice | Plasmid DNA, registered as a sample |
| Sequence check |  | alice | Sequencing result attached to the job |

## Notes
Send sequencing samples before 15:00 for next-day results.
