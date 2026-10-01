// Writes THIRD_PARTY_NOTICES.md: the license of every package bundled into the app or the team server.
//
// Prem bundles its dependencies into out/ (so they're devDependencies and npm can't tell runtime from
// tooling). This starts from the packages the app imports at runtime and follows their dependencies.
// Electron's and Chromium's own licenses are added to installers by electron-builder.
//
// Usage: node scripts/third-party-notices.mjs [--check]
//   --check  fail if any bundled package has no license, without writing the file
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')

// Packages imported by src/ at runtime. Keep this in step with the imports in src/main, src/renderer and
// src/server; `npm run notices -- --check` in CI catches packages that are missing a license.
const RUNTIME_ROOTS = [
  'chokidar',
  'katex',
  'react',
  'react-dom',
  'react-force-graph-2d',
  'react-resizable-panels',
  '@lezer/common',
  '@lezer/highlight',
  '@lezer/markdown',
  ...readdirSync(path.join(root, 'node_modules', '@codemirror')).map((name) => `@codemirror/${name}`)
]

function readPackage(dir) {
  return JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'))
}

/** Finds a dependency the way Node does: next to the requiring package, then up the tree. */
function resolveDir(name, fromDir) {
  for (let dir = fromDir; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, 'node_modules', name)
    if (existsSync(path.join(candidate, 'package.json'))) return candidate
    if (dir === root || dir === path.dirname(dir)) return null
  }
}

function licenseText(dir) {
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f))
  return file ? readFileSync(path.join(dir, file), 'utf8').trim() : null
}

const seen = new Map()
function visit(name, fromDir) {
  const dir = resolveDir(name, fromDir)
  if (!dir) return
  const pkg = readPackage(dir)
  const key = `${pkg.name}@${pkg.version}`
  if (seen.has(key)) return
  const license = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type
  seen.set(key, { name: pkg.name, version: pkg.version, license, homepage: pkg.homepage, text: licenseText(dir) })
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, dir)
}

for (const name of RUNTIME_ROOTS) visit(name, root)

const packages = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
const missing = packages.filter((p) => !p.license)
if (missing.length) {
  console.error(`No license declared by: ${missing.map((p) => p.name).join(', ')}`)
  process.exit(1)
}
if (process.argv.includes('--check')) {
  console.log(`${packages.length} bundled packages, all with a declared license.`)
  process.exit(0)
}

const lines = [
  '# Third-party notices',
  '',
  'Prem includes the following open-source packages. Each is used under the license shown.',
  'Electron and Chromium licenses are included with the app as `LICENSE.electron.txt` and `LICENSES.chromium.html`.',
  ''
]
for (const p of packages) {
  lines.push(
    `## ${p.name} ${p.version}`,
    '',
    `License: ${p.license}${p.homepage ? `  \nHomepage: ${p.homepage}` : ''}`,
    ''
  )
  if (p.text) lines.push('```', p.text, '```', '')
}
writeFileSync(path.join(root, 'THIRD_PARTY_NOTICES.md'), lines.join('\n'))
console.log(`Wrote THIRD_PARTY_NOTICES.md with ${packages.length} packages.`)
