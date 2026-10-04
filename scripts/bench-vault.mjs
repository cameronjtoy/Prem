// Makes a large vault for checking that Prem stays quick with years of notes:
//   node scripts/bench-vault.mjs <folder> [notes=10000] [attachments=2000]
// Notes link to each other, protocols have runs, workflows have jobs, and a share of entries have attachments,
// roughly in the proportions a busy lab builds up. The same arguments always produce the same vault.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [dir, notesArg = '10000', attachmentsArg = '2000'] = process.argv.slice(2)
if (!dir) {
  console.error('Usage: node scripts/bench-vault.mjs <folder> [notes] [attachments]')
  process.exit(1)
}
const NOTES = Number(notesArg)
const ATTACHMENTS = Number(attachmentsArg)

// A small seeded random generator, so every run makes the same vault.
let seed = 42
const random = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296
const pick = (list) => list[Math.floor(random() * list.length)]

const words =
  'buffer plasmid ligation insert colony culture gel band primer digest miniprep sequence yield sample plate reader absorbance incubate centrifuge pellet supernatant elute wash'.split(
    ' '
  )
const sentence = (n) =>
  Array.from({ length: n }, () => pick(words))
    .join(' ')
    .replace(/^./, (c) => c.toUpperCase()) + '.'

const write = (rel, content) => {
  const file = path.join(dir, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, content)
}

const protocols = Array.from({ length: 40 }, (_, i) => `Protocol ${String(i + 1).padStart(3, '0')}`)
for (const name of protocols) {
  const steps = Array.from({ length: 8 }, (_, i) => `- [ ] Step ${i + 1}: ${sentence(8)}`).join('\n')
  write(`Protocols/${name}.md`, `---\ntype: protocol\nversion: 1\n---\n# ${name}\n\n## Steps\n${steps}\n`)
}

const samples = Array.from({ length: 300 }, (_, i) => `S-${String(i + 1).padStart(4, '0')}`)
for (const id of samples) write(`Samples/${id}.md`, `---\ntype: sample\nid: ${id}\n---\n# ${id}\n\n${sentence(12)}\n`)

write(
  'Workflows/Plate prep.md',
  `---\ntype: workflow\nversion: 1\n---\n# Plate prep\n\n## Stages\n| Stage | Protocol | Assignee | Outputs |\n| --- | --- | --- | --- |\n| Pour | [[${protocols[0]}]] | alice | Plates |\n| Check | | bob | Counts |\n`
)

const titles = []
let attachments = 0
const remaining = NOTES - protocols.length - samples.length - 1
for (let i = 0; i < remaining; i++) {
  const day = new Date(Date.UTC(2020, 0, 1) + i * 4 * 3600_000)
  const year = day.getUTCFullYear()
  const date = day.toISOString().slice(0, 10)
  let rel
  let body
  if (i % 10 === 0) {
    const protocol = pick(protocols)
    const title = `${protocol} run ${date} ${String(i).padStart(5, '0')}`
    rel = `Notebook/Runs/${year}/${title}.md`
    const steps = Array.from(
      { length: 8 },
      (_, s) => `- [x] Step ${s + 1}: ${sentence(8)} (${date} 10:${String(s).padStart(2, '0')})`
    )
    body = `---\ntype: run\nprotocol: "[[${protocol}]]"\nstatus: complete\n---\n# ${title}\n\n## Steps\n${steps.join('\n')}\n`
  } else if (i % 50 === 1) {
    const title = `Plate prep job ${date} ${String(i).padStart(5, '0')}`
    rel = `Jobs/Plate prep/${title}.md`
    body = `---\ntype: job\nworkflow: "[[Plate prep]]"\nstage: ${pick(['Pour', 'Check'])}\nassignee: ${pick(['alice', 'bob'])}\nstatus: in progress\ncreated: ${date} 09:00\n---\n# ${title}\n\n## Stages\n| Stage | Protocol | Assignee | Outputs |\n| --- | --- | --- | --- |\n| Pour | [[${protocols[0]}]] | alice | Plates |\n| Check | | bob | Counts |\n`
  } else {
    const title = `${date} ${pick(words)} ${String(i).padStart(5, '0')}`
    rel = `Notebook/${year}/${title}.md`
    const links = Array.from({ length: 3 }, () => `[[${titles.length ? pick(titles) : pick(samples)}]]`).join(', ')
    const paragraphs = Array.from({ length: 6 }, () => sentence(25)).join('\n\n')
    body = `---\ntype: experiment\n---\n# ${title}\n\nSee ${links} and [[${pick(samples)}]].\n\n${paragraphs}\n`
    if (attachments < ATTACHMENTS && i % Math.max(1, Math.floor(remaining / ATTACHMENTS)) === 0) {
      const csv = `attachments/plate-${i}.csv`
      write(
        path.join(path.dirname(rel), csv),
        'well,od\n' + Array.from({ length: 96 }, (_, w) => `W${w},${random().toFixed(3)}`).join('\n')
      )
      body += `\n![Plate](${csv})\n`
      attachments++
    }
    titles.push(title)
  }
  write(rel, body)
}

console.log(`Wrote ${NOTES} notes and ${attachments} attachments to ${dir}`)
