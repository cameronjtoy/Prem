// Builds the website in site/ into _site/, ready for GitHub Pages.
//
// Every page shares site/layout.html. Pages are site/pages/*.html, which start with a comment holding their title
// and description; docs pages are rendered from the markdown in docs/, so the guides on the site and in the repo
// are the same text. Links between published docs point at their pages; links to anything else in the repo point
// at GitHub. After building, every internal link and #anchor is checked, and the build fails on a broken one.
//
// Usage: node scripts/build-site.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { Marked } from 'marked'

const root = path.resolve(import.meta.dirname, '..')
const siteDir = path.join(root, 'site')
const outDir = path.join(root, '_site')
const REPO_URL = 'https://github.com/cameronjtoy/Prem'

/** Markdown files in the repo published as docs pages, in the order the docs index lists them. */
const DOCS = [
  {
    source: 'docs/install.md',
    page: 'docs/install.html',
    title: 'Installing Prem',
    description: 'Installing Prem on macOS, Windows and Linux, and running the lab server with Docker or Node.js.'
  },
  {
    source: 'docs/lab-server.md',
    page: 'docs/lab-server.html',
    title: 'Running a lab server',
    description:
      'Setting up the Prem server for a lab: people and permissions, HTTPS with Tailscale or Caddy, and backups.'
  },
  {
    source: 'docs/ARCHITECTURE.md',
    page: 'docs/architecture.html',
    title: 'Architecture',
    description: "For contributors: how Prem's layers fit together, where data is stored, and where new code belongs."
  }
]

const layout = readFileSync(path.join(siteDir, 'layout.html'), 'utf8')

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** Wraps page content in the layout. `page` is the output path, used to make links relative to the site root. */
function render(page, { title, description, content }) {
  const depth = page.split('/').length - 1
  const vars = { title: escapeHtml(title), description: escapeHtml(description), root: '../'.repeat(depth), content }
  return layout.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key])
}

function write(page, html) {
  const file = path.join(outDir, page)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, html)
}

/** GitHub-style heading anchors, so links like install.md#the-lab-server work on the site too. */
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&[a-z]+;|&#\d+;/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .trim()
    .replace(/\s/g, '-')
}

/** Points a link in a markdown doc at its page on the site, or at the file on GitHub. */
function rewriteLink(href, sourceFile, fromPage) {
  if (/^([a-z]+:|#|\/\/)/i.test(href)) return href
  const [target, hash = ''] = href.split('#')
  const repoPath = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), decodeURIComponent(target)))
  const anchor = hash ? `#${hash}` : ''
  const published = DOCS.find((d) => d.source === repoPath)
  if (published) return path.posix.relative(path.posix.dirname(fromPage), published.page) + anchor
  const full = path.join(root, repoPath)
  const kind = existsSync(full) && statSync(full).isDirectory() ? 'tree' : 'blob'
  return `${REPO_URL}/${kind}/main/${repoPath.split('/').map(encodeURIComponent).join('/')}${anchor}`
}

function renderMarkdown(doc) {
  const marked = new Marked({
    gfm: true,
    walkTokens(token) {
      if (token.type === 'link') token.href = rewriteLink(token.href, doc.source, doc.page)
    },
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens)
        return `<h${depth} id="${slugify(inner)}">${inner}</h${depth}>\n`
      }
    }
  })
  const markdown = readFileSync(path.join(root, doc.source), 'utf8')
  const body = marked.parse(markdown)
  const source = `<p class="doc-source">This page is <a href="${REPO_URL}/blob/main/${doc.source}">${doc.source}</a> in the repository. Corrections are welcome.</p>`
  return `<article class="wrap page doc">${body}${source}</article>`
}

/** Reads the `title:` and `description:` lines from the comment at the top of a page. */
function pageMeta(html, file) {
  const header = html.match(/^<!--([\s\S]*?)-->\s*/)
  if (!header) throw new Error(`${file} must start with a comment giving its title and description`)
  const field = (name) => header[1].match(new RegExp(`^\\s*${name}:\\s*(.+)$`, 'm'))?.[1].trim()
  const title = field('title')
  const description = field('description')
  if (!title || !description) throw new Error(`${file} needs a title and a description`)
  return { title, description, content: html.slice(header[0].length) }
}

// Build

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir)
cpSync(path.join(siteDir, 'assets'), path.join(outDir, 'assets'), { recursive: true })
for (const file of ['style.css', 'download.js']) cpSync(path.join(siteDir, file), path.join(outDir, file))
writeFileSync(path.join(outDir, '.nojekyll'), '')

for (const file of readdirSync(path.join(siteDir, 'pages'))) {
  const meta = pageMeta(readFileSync(path.join(siteDir, 'pages', file), 'utf8'), file)
  write(file, render(file, meta))
}

for (const doc of DOCS) {
  write(
    doc.page,
    render(doc.page, { title: `${doc.title} · Prem`, description: doc.description, content: renderMarkdown(doc) })
  )
}

const docsIndex = `<section class="wrap page">
<h1>Documentation</h1>
<ul class="doc-list">
${DOCS.map((d) => `<li><a href="${path.posix.relative('docs', d.page)}">${escapeHtml(d.title)}</a><p>${escapeHtml(d.description)}</p></li>`).join('\n')}
<li><a href="${REPO_URL}/blob/main/CONTRIBUTING.md">Contributing</a><p>Setting up a development copy, the checks a pull request needs, and how releases are made.</p></li>
</ul>
</section>`
write(
  'docs/index.html',
  render('docs/index.html', {
    title: 'Prem documentation',
    description: 'Guides for using, hosting and contributing to Prem.',
    content: docsIndex
  })
)

// Check links

const problems = []
const pages = []
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full)
    else if (entry.name.endsWith('.html')) pages.push(full)
  }
}
walk(outDir)
const idsOf = new Map(
  pages.map((p) => [p, new Set([...readFileSync(p, 'utf8').matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]))])
)
for (const page of pages) {
  const html = readFileSync(page, 'utf8')
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (/^([a-z]+:|\/\/)/i.test(url)) continue
    const [target, hash] = url.split('#')
    const file = target ? path.resolve(path.dirname(page), decodeURIComponent(target)) : page
    const where = path.relative(outDir, page)
    if (!existsSync(file)) problems.push(`${where}: ${url} doesn't exist`)
    else if (hash && file.endsWith('.html') && !idsOf.get(file)?.has(hash))
      problems.push(`${where}: no #${hash} in ${target || 'this page'}`)
  }
}
if (problems.length) {
  console.error(`Broken links:\n  ${problems.join('\n  ')}`)
  process.exit(1)
}
console.log(`Built ${pages.length} pages into _site/; all internal links resolve.`)
