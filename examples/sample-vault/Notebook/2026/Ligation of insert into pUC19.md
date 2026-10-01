---
type: experiment
author: alice
date: 2026-09-30
project: Reporter construct
status: in progress
tags: [experiment, cloning]
---

# Ligation of insert into pUC19

## Aim
Clone the 1.2 kb *gfp* insert into the EcoRI/HindIII sites of pUC19 and confirm by colony PCR.

## Hypothesis
A 3:1 insert:vector molar ratio with T4 ligase at 16 °C overnight gives more than 50 colonies, most carrying the insert.

## Samples and materials
- [[S-0001]] — pUC19 miniprep, 112 ng/µL
- [[S-0003]] — EcoRI/HindIII-digested *gfp* insert, 28 ng/µL
- T4 DNA ligase and 10× buffer
- DH5α chemically competent cells

## Method
Protocol: [[Plasmid miniprep]] for the vector, then ligation as below.

Changes from the protocol: ligation set up at 3:1 molar ratio in 20 µL, 16 °C overnight instead of the 1 h room-temperature step.

| Component | Volume |
| --- | ---: |
| pUC19 (50 ng) | 0.45 µL |
| *gfp* insert (3:1 molar) | 2.4 µL |
| 10× ligase buffer | 2 µL |
| T4 DNA ligase | 1 µL |
| Water | to 20 µL |

Transformed 5 µL into 50 µL DH5α, plated on LB + ampicillin, 37 °C overnight.

## Results
Colony PCR of eight colonies with M13 forward and reverse primers. Lanes 2–4, 6 and 7 show the expected ~1.4 kb product (insert plus flanking sequence); lane 5 shows only the ~0.2 kb empty-vector band.

![gel 2026-09-30.png](attachments/gel%202026-09-30.png)

| Count | Value |
| --- | ---: |
| Colonies on plate | 84 |
| Colonies screened | 8 |
| Positive by PCR | 6 |

## Conclusions
Ligation worked. 6 of 8 screened colonies carry the insert, consistent with the hypothesis. Colony 5 is empty vector.

## Next steps
- [ ] Miniprep colonies 2 and 3 and send for Sanger sequencing
- [ ] Register the confirmed clone as a new sample
