---
type: reference
owner: Finance
last-reviewed: 2026-09-27
---

# Unit economics

The core formulas we use to judge whether growth is healthy. Definitions are in the [[Glossary]].

## Gross margin
$$
\text{Gross margin} = \frac{\text{Revenue} - \text{COGS}}{\text{Revenue}}
$$

## Customer lifetime value
With average revenue per account $ARPA$, gross margin $m$ and monthly churn $c$:

$$
LTV = \frac{ARPA \times m}{c}
$$

## Payback period
$$
\text{Payback (months)} = \frac{CAC}{ARPA \times m}
$$

We aim for $LTV / CAC \geq 3$ and a payback period under 12 months.

## Worked example
| Input | Value |
| --- | ---: |
| ARPA | $400 / month |
| Gross margin | 80% |
| Monthly churn | 2% |
| CAC | $4,800 |

That gives $LTV = 400 \times 0.8 / 0.02 = 16{,}000$, so $LTV/CAC \approx 3.3$.
