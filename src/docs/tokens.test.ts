import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// The colour tokens in app.css are the design system (docs/DESIGN_SYSTEM.md). These checks keep the two in step,
// keep both themes complete, and keep text readable.

const root = path.resolve(__dirname, '../..')
const styles = path.join(root, 'src/renderer/src/styles')
const appCss = readFileSync(path.join(styles, 'app.css'), 'utf8')
const doc = readFileSync(path.join(root, 'docs/DESIGN_SYSTEM.md'), 'utf8')

/** The declarations in the first `{ … }` after `start`. */
function block(css: string, start: string): Map<string, string> {
  const from = css.indexOf('{', css.indexOf(start))
  const body = css.slice(from + 1, css.indexOf('}', from))
  return new Map([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]))
}

const light = block(appCss, ':root')
const dark = block(appCss, '@media (prefers-color-scheme: dark)')
/** Tokens that aren't colours: fonts and sizes the settings change. */
const isColour = (name: string): boolean => !/^--(font|editor)-/.test(name)

const linear = (c: number): number => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('colour tokens', () => {
  it('are all defined in the dark theme too', () => {
    const missing = [...light.keys()].filter((name) => isColour(name) && !dark.has(name))
    expect(missing).toEqual([])
    expect([...dark.keys()].filter((name) => !light.has(name))).toEqual([])
  })

  it('are all described in docs/DESIGN_SYSTEM.md', () => {
    const undocumented = [...light.keys()].filter((name) => !doc.includes(`\`${name}\``))
    expect(undocumented).toEqual([])
  })

  it('keep text readable on every background, in both themes (WCAG AA)', () => {
    const failures: string[] = []
    for (const [theme, tokens] of [
      ['light', light],
      ['dark', dark]
    ] as const) {
      for (const text of ['--text', '--text-strong', '--text-muted', '--accent', '--danger', '--success']) {
        for (const bg of ['--bg', '--bg-side', '--bg-elevated']) {
          const ratio = contrast(tokens.get(text)!, tokens.get(bg)!)
          if (ratio < 4.5) failures.push(`${theme} ${text} on ${bg}: ${ratio.toFixed(2)}`)
        }
      }
      // Faint is for decoration and repeated detail (chevrons, list marks, done tasks), never for information:
      // it needs the 3:1 of non-text marks.
      for (const bg of ['--bg', '--bg-side', '--bg-elevated']) {
        const ratio = contrast(tokens.get('--text-faint')!, tokens.get(bg)!)
        if (ratio < 3) failures.push(`${theme} --text-faint on ${bg}: ${ratio.toFixed(2)}`)
      }
      const onAccent = contrast(tokens.get('--on-accent')!, tokens.get('--accent')!)
      if (onAccent < 4.5) failures.push(`${theme} --on-accent on --accent: ${onAccent.toFixed(2)}`)
    }
    expect(failures).toEqual([])
  })

  it('are the only colours in the stylesheets, apart from marked exceptions', () => {
    const stray: string[] = []
    for (const file of ['app.css', 'editor.css']) {
      const lines = readFileSync(path.join(styles, file), 'utf8').split('\n')
      // Skip the token blocks themselves: everything up to the end of the dark theme in app.css.
      const start = file === 'app.css' ? lines.findIndex((l, i) => i > 0 && l === '}' && lines[i - 1] === '  }') + 1 : 0
      lines.forEach((line, i) => {
        if (i < start || !/#[0-9a-f]{3,8}\b|rgba?\(/i.test(line)) return
        if (/fixed:/.test(lines[i - 1] ?? '')) return
        stray.push(`${file}:${i + 1}: ${line.trim()}`)
      })
    }
    expect(stray).toEqual([])
  })

  it('measures contrast like WCAG', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#777777', '#ffffff')).toBeCloseTo(4.48, 1)
  })
})
