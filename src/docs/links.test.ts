import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The docs link to source files and to each other. Code moves; this keeps the links from going stale.

const root = path.resolve(__dirname, '../..')
const files = [
  'README.md',
  'CONTRIBUTING.md',
  'SECURITY.md',
  ...readdirSync(path.join(root, 'docs'))
    .filter((f) => f.endsWith('.md'))
    .map((f) => `docs/${f}`)
]

/** The anchor GitHub gives a heading. */
const slug = (heading: string): string =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[`*_]/g, '')
    .replace(/[^\p{L}\p{N} -]/gu, '')
    .replace(/ /g, '-')

function anchors(file: string): Set<string> {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '')
  return new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map((m) => slug(m[1])))
}

function links(text: string): string[] {
  return [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
}

describe('links in the docs', () => {
  for (const file of files) {
    it(`${file} links only to things that exist`, () => {
      const abs = path.join(root, file)
      const text = readFileSync(abs, 'utf8')
      const broken: string[] = []
      for (const target of links(text.replace(/```[\s\S]*?```/g, ''))) {
        if (/^[a-z]+:/i.test(target)) continue
        const [rel, anchor] = target.split('#')
        const dest = rel ? path.resolve(path.dirname(abs), decodeURIComponent(rel)) : abs
        if (!existsSync(dest)) {
          broken.push(target)
          continue
        }
        if (anchor && dest.endsWith('.md') && !anchors(dest).has(anchor)) broken.push(target)
      }
      expect(broken).toEqual([])
    })
  }

  it('reads anchors the way GitHub makes them', () => {
    expect(slug('Diagnostics and backup')).toBe('diagnostics-and-backup')
    expect(slug('`prem` package: install')).toBe('prem-package-install')
  })
})
