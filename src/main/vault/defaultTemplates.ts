export const DEFAULT_TEMPLATES: Record<string, string> = {
  'Runbook.md': `---
type: runbook
owner:
last-reviewed: {{date}}
tags: [runbook]
---

# {{title}}

## Purpose
{{cursor}}

## When to use
- Symptom or trigger that means this runbook applies

## Prerequisites
- [ ] Access to the relevant system
- [ ] Someone to escalate to is available

## Steps
1. [ ] First step
   \`\`\`bash
   # command to run
   \`\`\`
2. [ ] Second step
3. [ ] Third step

## Verification
- How to confirm the fix worked

## Rollback
1. [ ] How to undo the steps above

## Escalation
| Role | Name | Contact |
| --- | --- | --- |
| Primary |  |  |
| Backup |  |  |

## Related
- [[ ]]
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
Inline math looks like $a^2 + b^2 = c^2$. Display math goes in a block:

$$
\\text{Gross margin} = \\frac{\\text{Revenue} - \\text{COGS}}{\\text{Revenue}}
$$

## Related
- [[ ]]
`,
  'Meeting.md': `---
type: meeting
date: {{date}}
---

# {{title}}

**Attendees:**

## Agenda
- {{cursor}}

## Notes

## Decisions

## Action items
- [ ] Owner — action — due date
`
}
