/**
 * Q019: every chart takes its colours from one shared soft palette.
 *
 * The owner rejected the original blue-and-brick pair and picked a soft palette
 * (M050). That palette lives once, as the `--series-*`, `--ramp-*` and
 * `--stage-*` custom properties in `index.css`. A chart that writes a hex value
 * of its own has left it, so this reads the chart sources and checks that every
 * colour they name is one of those tokens.
 */

import { describe, expect, it } from 'vitest'
import indexCss from '@/index.css?raw'

const CHART_FILES = [
  '/src/components/charts/Donut.tsx',
  '/src/components/charts/Pie.tsx',
  '/src/components/charts/Radar.tsx',
  '/src/components/dashboard/ApplicationFrequency.tsx',
  '/src/components/dashboard/ApplicationSources.tsx',
  '/src/components/dashboard/PipelineBreakdown.tsx',
  '/src/components/dashboard/SearchHealth.tsx',
  '/src/routes/Statistics.tsx',
] as const

const sources = import.meta.glob(
  [
    '/src/components/charts/Donut.tsx',
    '/src/components/charts/Pie.tsx',
    '/src/components/charts/Radar.tsx',
    '/src/components/dashboard/ApplicationFrequency.tsx',
    '/src/components/dashboard/ApplicationSources.tsx',
    '/src/components/dashboard/PipelineBreakdown.tsx',
    '/src/components/dashboard/SearchHealth.tsx',
    '/src/routes/Statistics.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const withoutComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')

/** The value a custom property is given in the block that starts at `selector`. */
function blockOf(css: string, selector: RegExp): string {
  const start = css.search(selector)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i)
  }
  return ''
}

const declared = (block: string, name: string) =>
  new RegExp(`--${name}:\\s*#[0-9a-fA-F]{6}`).test(block)

describe('the chart palette', () => {
  it('reads every chart source it means to', () => {
    for (const file of CHART_FILES) expect(sources[file], file).toBeTruthy()
  })

  it('is never bypassed by a colour literal in a chart', () => {
    const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|\boklch\(/
    for (const file of CHART_FILES) {
      expect(withoutComments(sources[file] ?? ''), file).not.toMatch(literal)
    }
  })

  it('is what the series charts are coloured from', () => {
    const frequency = sources['/src/components/dashboard/ApplicationFrequency.tsx'] ?? ''
    const slot = /const SLOT = \[([\s\S]*?)\]/.exec(frequency)?.[1] ?? ''
    expect(slot.match(/var\(--series-\d\)/g)).toHaveLength(5)

    const sourcesPanel = sources['/src/components/dashboard/ApplicationSources.tsx'] ?? ''
    const ramp = /const RAMP = \[([\s\S]*?)\]/.exec(sourcesPanel)?.[1] ?? ''
    expect(ramp.match(/var\(--ramp-\d\)/g)).toHaveLength(4)

    expect(sources['/src/components/dashboard/SearchHealth.tsx']).toContain("color: 'var(--series-1)'")
  })

  it('is declared once per theme, in light and in dark', () => {
    const light = blockOf(indexCss, /^:root,\s*html\[data-theme='light'\]\s*\{/m)
    const dark = blockOf(indexCss, /^html\[data-theme='dark'\]\s*\{/m)
    expect(light).not.toBe('')
    expect(dark).not.toBe('')
    for (const block of [light, dark]) {
      for (const i of [1, 2, 3, 4, 5]) expect(declared(block, `series-${i}`)).toBe(true)
      for (const i of [1, 2, 3, 4]) expect(declared(block, `ramp-${i}`)).toBe(true)
    }
  })
})
