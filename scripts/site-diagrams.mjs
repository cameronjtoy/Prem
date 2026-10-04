// Draws the diagrams on the website and in the README, as SVG files in site/assets/diagrams/.
// They're plain SVG with their own colours for light and dark mode, so they look right wherever they're shown,
// including as an <img> on GitHub. Run `npm run site:diagrams` after changing this file, and commit the SVGs.

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const outDir = path.join(root, 'site/assets/diagrams')

const SANS = "-apple-system, 'Segoe UI', Inter, system-ui, Roboto, sans-serif"
const MONO = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"

// The site's warm paper and logo teal, for light and dark.
const STYLE = `
  .bg { fill: #faf9f5 } .panel { fill: #f2f0e9; stroke: #e5e2d9 }
  .box { fill: #ffffff; stroke: #d9d5ca; stroke-width: 1.2 }
  .key { fill: #e3ebec; stroke: #4c6f77; stroke-width: 1.4 }
  .done { fill: #e6f0e8; stroke: #3f7d4e; stroke-width: 1.4 }
  .warn { fill: #f8ecd9; stroke: #a8661a; stroke-width: 1.4 }
  .ghost { fill: none; stroke: #8d887b; stroke-width: 1.2; stroke-dasharray: 5 4 }
  .rule { stroke: #e5e2d9 }
  .t { font: 600 14px ${SANS}; fill: #1a1915 }
  .h { font: 600 15px ${SANS}; fill: #1a1915 }
  .s { font: 12px ${SANS}; fill: #6e6a5f }
  .m { font: 11.5px ${MONO}; fill: #4a4740 }
  .lane { font: 600 11px ${MONO}; letter-spacing: 0.08em; fill: #6e6a5f }
  .label { font: 11.5px ${SANS}; fill: #6e6a5f }
  .accent { fill: #4c6f77 } .accent-text { font: 600 11px ${SANS}; fill: #4c6f77 }
  .ok { font: 600 11px ${SANS}; fill: #3f7d4e } .bad { font: 600 11px ${SANS}; fill: #a8661a }
  .chip { fill: #e3ebec } .chip-text { font: 600 11px ${SANS}; fill: #2e2c27 }
  .badge { fill: #4c6f77 } .badge-text { font: 700 10px ${SANS}; fill: #ffffff }
  .edge { stroke: #8d887b; stroke-width: 1.5; fill: none } .edge.dash { stroke-dasharray: 5 4 }
  .edge.key-edge { stroke: #4c6f77; stroke-width: 2 }
  .head { fill: #8d887b } .head.key-head { fill: #4c6f77 }
  @media (prefers-color-scheme: dark) {
    .bg { fill: #262624 } .panel { fill: #1f1e1c; stroke: #3d3c38 }
    .box { fill: #302f2c; stroke: #4a4844 }
    .key { fill: #33403f; stroke: #9dbcc2 }
    .done { fill: #26342a; stroke: #8dc49a }
    .warn { fill: #3a2f1f; stroke: #e3ad62 }
    .ghost { stroke: #8a867c } .rule { stroke: #3d3c38 }
    .t, .h { fill: #f7f5ef } .s, .lane, .label { fill: #a7a398 } .m { fill: #d4d0c6 }
    .accent { fill: #9dbcc2 } .accent-text { fill: #9dbcc2 }
    .ok { fill: #8dc49a } .bad { fill: #e3ad62 }
    .chip { fill: #33403f } .chip-text { fill: #e9e6dd }
    .badge { fill: #9dbcc2 } .badge-text { fill: #1a1d1d }
    .edge { stroke: #8a867c } .edge.key-edge { stroke: #9dbcc2 }
    .head { fill: #8a867c } .head.key-head { fill: #9dbcc2 }
  }`

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** A small drawing kit: each function returns SVG markup. */
function canvas(width, height, title, description) {
  const parts = []
  const add = (s) => parts.push(s)
  const kit = {
    rect: (x, y, w, h, cls, rx = 9) =>
      add(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" class="${cls}"/>`),
    text: (x, y, s, cls, anchor = 'start') =>
      add(
        `<text x="${x}" y="${y}" class="${cls}"${anchor === 'start' ? '' : ` text-anchor="${anchor}"`}>${esc(s)}</text>`
      ),
    line: (x1, y1, x2, y2, cls) => add(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${cls}"/>`),
    /** A box with a title and up to a few lines under it. */
    box(x, y, w, h, heading, lines = [], cls = 'box', mono = false) {
      kit.rect(x, y, w, h, cls)
      kit.text(x + 14, y + 25, heading, 't')
      lines.forEach((l, i) => kit.text(x + 14, y + 45 + i * 18, l, mono ? 'm' : 's'))
    },
    /** An arrow through `points`; the head points at the last one. */
    arrow(points, { dashed = false, key = false, label, lx, ly, anchor = 'middle', both = false } = {}) {
      const d = 'M' + points.map(([x, y]) => `${x},${y}`).join(' L')
      const marker = key ? 'k' : 'a'
      add(
        `<path d="${d}" class="edge${dashed ? ' dash' : ''}${key ? ' key-edge' : ''}" marker-end="url(#${marker})"${both ? ` marker-start="url(#${marker})"` : ''}/>`
      )
      if (label) kit.text(lx, ly, label, 'label', anchor)
    },
    chip(x, y, s, w = s.length * 6.6 + 16) {
      kit.rect(x, y, w, 20, 'chip', 10)
      kit.text(x + w / 2, y + 14, s, 'chip-text', 'middle')
      return w
    },
    svg: () =>
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="title desc">
<title id="title">${esc(title)}</title>
<desc id="desc">${esc(description)}</desc>
<!-- Drawn by scripts/site-diagrams.mjs; edit that, not this file. -->
<style>${STYLE}
</style>
<defs>
  <marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="head"/></marker>
  <marker id="k" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="head key-head"/></marker>
</defs>
<rect width="${width}" height="${height}" class="bg"/>
${parts.join('\n')}
</svg>
`
  }
  return kit
}

/** Board columns and history entries are laid out left to right at these steps. */
const col = (i) => 112 + i * 158
const cx = (i) => 20 + i * 184
const ex = (i) => 20 + i * 176

const diagrams = {}

// 1. Where everything lives: the app, your vault folder, Python, other apps, and the optional lab server.
diagrams['overview.svg'] = (() => {
  const k = canvas(
    680,
    430,
    'How Prem fits together',
    'Prem reads and writes plain markdown files in a vault folder you own, with every save kept in a hash-chained history. Python cells and scripts write results into the same notes. An optional lab server shares one vault with a team, with roles and per-folder permissions.'
  )
  k.rect(16, 16, 404, 398, 'panel', 12)
  k.text(32, 40, 'ON YOUR COMPUTER', 'lane')
  k.box(
    36,
    56,
    364,
    70,
    'Prem',
    ['Notes, protocols, runs, jobs and the board', 'Signing, history, search and PDF export'],
    'key'
  )
  k.box(
    36,
    186,
    364,
    122,
    'Your vault: a folder you own',
    [
      'Notebook/2026/Ligation of insert.md',
      'Protocols/  Workflows/  Jobs/  Samples/',
      'attachments/gel.png  plate.csv',
      '.prem/history/  every save, hash-chained'
    ],
    'box',
    true
  )
  k.arrow(
    [
      [218, 126],
      [218, 186]
    ],
    { both: true, label: 'plain markdown files', lx: 228, ly: 160, anchor: 'start' }
  )
  k.box(36, 336, 172, 62, 'Python', ['Cells, scripts, Jupyter'])
  k.box(228, 336, 172, 62, 'Other apps', ['Any editor, sync or git'], 'ghost')
  k.arrow(
    [
      [122, 336],
      [122, 308]
    ],
    { label: 'figures, results', lx: 130, ly: 326, anchor: 'start' }
  )
  k.arrow(
    [
      [314, 336],
      [314, 308]
    ],
    { dashed: true, label: 'recorded too', lx: 322, ly: 326, anchor: 'start' }
  )
  k.text(458, 112, 'OPTIONAL', 'lane')
  k.box(
    450,
    124,
    214,
    170,
    'Lab server',
    [
      'One shared vault for the lab',
      'Roles: PI, member, viewer',
      'Permissions per folder',
      'Who changed what comes',
      "from each person's token"
    ],
    'box'
  )
  k.arrow(
    [
      [400, 92],
      [424, 92],
      [424, 160],
      [450, 160]
    ],
    { both: true, key: true }
  )
  k.text(458, 318, 'Connected over HTTPS,', 'label')
  k.text(458, 334, 'with one token per person', 'label')
  return k.svg()
})()

// 2. How a record moves: workflows and jobs above, protocols and runs in the middle, analysis below.
diagrams['lifecycle.svg'] = (() => {
  const k = canvas(
    1220,
    500,
    'How a record moves through Prem',
    'A workflow starts jobs; each job stage starts a run of a protocol; completing a run completes the stage and hands the job on. Runs and jobs are signed, witnessed and locked, and exported to PDF. Python cells and the prem package write analysis into the same entries, and every change is kept in the history.'
  )
  const W = 146
  const H = 58
  const rows = { A: 64, B: 214, C: 384 }
  const lanes = [
    ['A', 'PROCESS'],
    ['B', 'RECORD'],
    ['C', 'ANALYSIS']
  ]
  lanes.forEach(([r, name], i) => {
    if (i) k.line(14, rows[r] - 62, 1206, rows[r] - 62, 'rule')
    k.text(16, rows[r] + 4, name, 'lane')
  })
  const nodes = {}
  const node = (id, c, r, title, sub, cls = 'box') => {
    const x = col(c)
    const y = rows[r] - H / 2
    nodes[id] = { x, y, cx: x + W / 2, cy: y + H / 2 }
    k.rect(x, y, W, H, cls)
    k.text(x + 12, y + 25, title, 't')
    k.text(x + 12, y + 43, sub, 's')
  }
  const R = (n) => [nodes[n].x + W, nodes[n].cy]
  const L = (n) => [nodes[n].x, nodes[n].cy]
  const T = (n, dx = 0) => [nodes[n].cx + dx, nodes[n].y]
  const B = (n, dx = 0) => [nodes[n].cx + dx, nodes[n].y + H]
  const chain = (ids) => ids.slice(1).forEach((id, i) => k.arrow([R(ids[i]), L(id)]))

  node('wf', 0, 'A', 'Workflow', 'stages and who', 'key')
  node('nj', 1, 'A', 'New job', 'copies the stages')
  node('js', 2, 'A', 'Job stage', 'on the board')
  node('cs', 3, 'A', 'Complete stage', 'hands it on')
  node('jd', 4, 'A', 'Job done', 'stage log complete')
  node('bd', 5, 'A', 'My tasks', 'what waits on you')

  node('pr', 0, 'B', 'Protocol', 'materials, steps', 'key')
  node('sr', 1, 'B', 'Start run', 'copies the steps')
  node('rn', 2, 'B', 'Run', 'timed steps, notes')
  node('cr', 3, 'B', 'Complete run', 'finish time')
  node('sg', 4, 'B', 'Sign, witness', 'locks the record')
  node('lk', 5, 'B', 'Amend', 'with a reason')
  node('pdf', 6, 'B', 'PDF export', 'with signatures')

  node('sj', 0, 'C', 'Script, Jupyter', 'your own code', 'ghost')
  node('pk', 1, 'C', 'prem package', 'attach, record')
  node('pc', 2, 'C', 'Python cell', 'runs in the note', 'key')
  node('out', 3, 'C', 'Output', 'code, inputs, env')
  node('rp', 4, 'C', 'Reproduce', 'same or different?')
  node('hi', 5, 'C', 'History', 'every save, chained')

  chain(['wf', 'nj', 'js', 'cs', 'jd'])
  k.arrow([R('jd'), L('bd')], { dashed: true })
  chain(['pr', 'sr', 'rn', 'cr', 'sg', 'lk', 'pdf'])
  k.arrow([B('js', -20), T('rn', -20)], {
    label: 'each stage starts a run',
    lx: nodes.js.cx - 30,
    ly: 142,
    anchor: 'end'
  })
  k.arrow([T('cr'), B('cs')], { label: 'run done, stage done', lx: nodes.cr.cx + 10, ly: 142, anchor: 'start' })
  k.arrow([B('jd'), T('sg')], { label: 'sign the job', lx: nodes.jd.cx + 10, ly: 142, anchor: 'start' })
  chain(['sj', 'pk'])
  k.arrow([T('pk'), B('rn', -30)], { label: 'into the entry', lx: nodes.pk.cx + 10, ly: 300, anchor: 'start' })
  chain(['pc', 'out', 'rp'])
  k.arrow([T('out', 20), B('rn', 30)], { label: 'saved in the note', lx: nodes.out.cx + 28, ly: 300, anchor: 'start' })
  k.arrow([B('lk'), T('hi')], { label: 'every change', lx: nodes.lk.cx + 10, ly: 300, anchor: 'start' })
  k.text(1206, 478, 'Every box is a markdown note or a step in one; nothing lives in a database.', 'label', 'end')
  return k.svg()
})()

// 3. The board: jobs by stage, with a drag that completes a stage, and My tasks.
diagrams['board.svg'] = (() => {
  const k = canvas(
    760,
    330,
    'The board of jobs',
    'Every job of the Plasmid prep workflow, in a column per stage. Dragging a job to the next column completes its stage and hands it to the next person; dragging it back sends it back with a reason. My tasks counts the jobs waiting on you.'
  )
  k.text(20, 34, 'Plasmid prep', 'h')
  k.text(140, 34, '3 stages · 5 jobs', 's')
  // My tasks button with its badge
  k.rect(612, 16, 128, 28, 'box', 8)
  k.text(626, 35, 'My tasks', 't')
  k.rect(708, 22, 22, 16, 'badge', 8)
  k.text(719, 34, '2', 'badge-text', 'middle')
  const cols = ['Grow culture', 'Miniprep', 'Sequence check', 'Done']
  cols.forEach((name, i) => {
    k.rect(cx(i), 60, 172, 254, i === 1 ? 'key' : 'panel', 10)
    k.text(cx(i) + 12, 84, name, 't')
  })
  const card = (i, y, title, who, status, extra, cls = 'box') => {
    k.rect(cx(i) + 10, y, 152, 72, cls, 8)
    k.text(cx(i) + 22, y + 24, title, 't')
    const w = k.chip(cx(i) + 22, y + 36, who)
    k.text(cx(i) + 30 + w, y + 50, status, 's')
    if (extra) k.text(cx(i) + 22, y + 66 + 0, extra, 'accent-text')
  }
  card(0, 100, 'job 10-02 09:30', 'bob', 'open', '')
  card(1, 100, 'job 10-01 14:00', 'alice', 'in progress', 'run open')
  card(2, 100, 'job 09-28 09:00', 'alice', 'in progress', '2 samples')
  card(3, 100, 'job 09-15 10:00', 'bob', 'done', '')
  // A card on its way to the next column
  k.rect(cx(0) + 10, 200, 152, 72, 'ghost', 8)
  k.text(cx(0) + 22, 224, 'job 10-03 08:15', 't')
  k.chip(cx(0) + 22, 236, 'bob')
  k.arrow(
    [
      [cx(0) + 162, 236],
      [cx(1) + 24, 236]
    ],
    { key: true }
  )
  k.rect(cx(1) + 10, 200, 152, 72, 'ghost', 8)
  k.text(cx(1) + 86, 230, 'Drop to complete', 'accent-text', 'middle')
  k.text(cx(1) + 86, 246, 'Grow culture and', 'label', 'middle')
  k.text(cx(1) + 86, 260, 'hand the job to alice', 'label', 'middle')
  k.text(cx(2) + 12, 230, 'Drag back to send a', 'label')
  k.text(cx(2) + 12, 246, 'job back, with a reason.', 'label')
  k.text(cx(2) + 12, 270, 'On a team server, only the', 'label')
  k.text(cx(2) + 12, 286, 'assignee or a PI moves it.', 'label')
  return k.svg()
})()

// 4. Signing: the hash-chained history of one note.
diagrams['history.svg'] = (() => {
  const k = canvas(
    900,
    300,
    "A note's history",
    'Each save of a note is an entry in its history, and each entry includes the hash of the one before, so changing any past version or signature breaks the chain. Signing locks the note; a colleague witnesses it; later changes are amendments with a reason. Edits made outside Prem are recorded too, and flagged on a signed note.'
  )
  k.text(20, 34, 'Ligation of insert into pUC19.md', 'm')
  const entries = [
    ['Saved', 'alice · 09:12', 'a41c0e12', 'box'],
    ['Saved', 'alice · 11:40', '7d2b9f03', 'box'],
    ['Signed', 'alice · 16:05', 'c90e4a77', 'key'],
    ['Witnessed', 'bob · 16:31', '1f5d3b20', 'key'],
    ['Amended', 'alice · next day', '88ab0c51', 'warn']
  ]
  entries.forEach(([title, who, hash, cls], i) => {
    k.rect(ex(i), 56, 148, 104, cls)
    k.text(ex(i) + 14, 82, title, 't')
    k.text(ex(i) + 14, 101, who, 's')
    k.text(ex(i) + 14, 124, `hash ${hash}…`, 'm')
    k.text(ex(i) + 14, 142, i ? `prev ${entries[i - 1][2]}…` : 'prev none', 'm')
    if (i)
      k.arrow([
        [ex(i - 1) + 148, 108],
        [ex(i), 108]
      ])
  })
  k.text(ex(4) + 14, 178, 'reason: "fixed a unit typo"', 'label')
  k.line(20, 200, 880, 200, 'rule')
  k.text(20, 226, 'LOCKED', 'lane')
  k.text(110, 226, 'From Signed on, the note is read-only. Changing it takes an amendment with a reason.', 's')
  k.text(20, 252, 'CHECKED', 'lane')
  k.text(110, 252, 'Change any past version or signature and the chain no longer checks out. Prem says so.', 's')
  k.text(20, 278, 'OUTSIDE', 'lane')
  k.text(
    110,
    278,
    'Edits made in other apps are recorded as "Changed outside Prem", and flagged on a signed note.',
    's'
  )
  return k.svg()
})()

// 5. Analysis: a cell, its output with what produced it, and Reproduce.
diagrams['analysis.svg'] = (() => {
  const k = canvas(
    900,
    350,
    'Reproducible analysis in a note',
    'A Python cell runs in the note. Its output is saved under it with the code version, the Python and environment it ran in, and the files it read with their hashes. The environment’s full package list is saved next to the note. Reproduce rebuilds that environment, reruns the cells and says which outputs are the same.'
  )
  k.text(20, 34, 'IN THE NOTE', 'lane')
  k.rect(20, 46, 400, 92, 'box')
  k.text(34, 70, '```python {run}', 'm')
  k.text(34, 90, 'df = pd.read_csv("attachments/plate.csv")', 'm')
  k.text(34, 110, 'df.groupby("sample").od.mean()', 'm')
  k.text(34, 130, '```', 'm')
  k.arrow(
    [
      [220, 138],
      [220, 166]
    ],
    { label: 'Run', lx: 230, ly: 158, anchor: 'start' }
  )
  k.rect(20, 166, 400, 112, 'key')
  k.text(34, 190, 'Output, saved in the note', 't')
  k.text(34, 212, 'sample A 0.41 · sample B 0.88', 'm')
  let x = 34
  for (const c of ['code 3f2a91c0', 'Python 3.12.4', 'env 9b1e2c3d4f5a']) x += k.chip(x, 226, c) + 8
  k.chip(34, 252, 'read plate.csv @ a41c0e12')
  k.arrow([
    [220, 278],
    [220, 306]
  ])
  k.rect(20, 306, 400, 30, 'box', 8)
  k.text(34, 326, 'attachments/environment-9b1e2c3d4f5a.txt', 'm')

  k.text(480, 34, 'LATER, ON ANY COMPUTER', 'lane')
  k.box(
    480,
    46,
    400,
    70,
    'If plate.csv changes',
    ['The output is flagged, and so are the cells after it:', '"plate.csv changed since this output"'],
    'warn'
  )
  k.box(
    480,
    140,
    400,
    92,
    'Reproduce',
    [
      '1  Rebuild environment 9b1e2c3d4f5a exactly',
      '2  Rerun the cells in a fresh Python',
      '3  Compare text, tables and figures byte for byte'
    ],
    'key'
  )
  k.arrow(
    [
      [420, 321],
      [450, 321],
      [450, 186],
      [480, 186]
    ],
    { key: true }
  )
  k.rect(480, 256, 194, 80, 'done')
  k.text(494, 282, 'Same', 't')
  k.text(494, 302, 'All 2 outputs are the', 's')
  k.text(494, 320, 'same as recorded.', 's')
  k.rect(686, 256, 194, 80, 'warn')
  k.text(700, 282, 'Different', 't')
  k.text(700, 302, 'Printed text: different', 's')
  k.text(700, 320, 'Figure 1: same', 's')
  k.arrow([
    [620, 232],
    [578, 256]
  ])
  k.arrow([
    [740, 232],
    [782, 256]
  ])
  return k.svg()
})()

mkdirSync(outDir, { recursive: true })
for (const [name, svg] of Object.entries(diagrams)) writeFileSync(path.join(outDir, name), svg)
console.log(`Drew ${Object.keys(diagrams).length} diagrams into ${path.relative(root, outDir)}/`)
