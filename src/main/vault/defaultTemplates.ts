/** The template used by the Today button. A vault can override it with its own `templates/Daily entry.md`. */
export const DAILY_TEMPLATE = 'Daily entry.md'

export const DEFAULT_TEMPLATES: Record<string, string> = {
  'Experiment.md': `---
type: experiment
author: {{author}}
date: {{date}}
project:
status: in progress
tags: [experiment]
---

# {{title}}

## Aim
{{cursor}}

## Hypothesis

## Samples and materials
- [[ ]]

## Method
Protocol: [[ ]]

Changes from the protocol:

## Results

## Conclusions

## Next steps
- [ ] 
`,
  'Protocol.md': `---
type: protocol
version: 1
author: {{author}}
last-reviewed: {{date}}
tags: [protocol]
---

# {{title}}

## Purpose
{{cursor}}

## Safety
- PPE:
- Hazards:

## Materials
| Reagent or equipment | Amount | Notes |
| --- | --- | --- |
|  |  |  |

## Steps
1. [ ] First step
2. [ ] Second step
3. [ ] Third step

## Expected results

## Troubleshooting
| Problem | Likely cause | Fix |
| --- | --- | --- |
|  |  |  |

## References
`,
  'Workflow.md': `---
type: workflow
version: 1
author: {{author}}
tags: [workflow]
---

# {{title}}

## Purpose
{{cursor}}

## Stages
Each row is one stage, in order. Link a protocol to run it from the job, or leave it blank for a step done without one.

| Stage | Protocol | Assignee | Outputs |
| --- | --- | --- | --- |
| First stage | [[ ]] |  |  |
| Second stage | [[ ]] |  |  |

## Notes
`,
  'Sample.md': `---
type: sample
id: {{title}}
sample-type:
source:
location:
status: available
created: {{date}}
created-by: {{author}}
tags: [sample]
---

# {{title}}

## Description
{{cursor}}

## Storage
- Location:
- Amount:
- Concentration:

## Notes
Experiments and protocol runs that link to this sample are listed under Backlinks.
`,
  'Lab meeting.md': `---
type: meeting
date: {{date}}
---

# {{title}}

**Attendees:**

## Updates
- {{cursor}}

## Discussion

## Decisions

## Action items
- [ ] Who — what — by when
`,
  'Analysis.md': `---
type: analysis
date: {{date}}
author: {{author}}
---

# {{title}}

## Question
{{cursor}}

## Data
Attach the data files here, then read them below as \`attachments/<name>\`.

## Analysis
Choose Run (or press ⇧↵ in the code). The output is saved under the cell, with the files it read.

\`\`\`python {run}
import pandas as pd

# df = pd.read_csv("attachments/your-data.csv")
# df.describe()
\`\`\`

## Conclusion
`,
  'Reference.md': `---
type: reference
last-reviewed: {{date}}
---

# {{title}}

## Summary
{{cursor}}

## Details

## Formulas
Inline math looks like $C_1 V_1 = C_2 V_2$. Display math goes in a block:

$$
\\text{Molarity} = \\frac{\\text{moles of solute}}{\\text{litres of solution}}
$$

## Related
- [[ ]]
`,
  [DAILY_TEMPLATE]: `---
type: daily
date: {{date}}
author: {{author}}
---

# {{title}}

## Plan
- [ ] {{cursor}}

## Notes

## Experiments
- [[ ]]
`
}
