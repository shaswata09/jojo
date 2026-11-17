/**
 * Q020: "Where they came from" switches between a donut and progress bars from
 * a control in its own card.
 *
 * Both views and the switch only exist in the JSX, so D20 leaves a narrow
 * source read: the two options, the control that sets them, and that each
 * option draws its own view.
 */

import { describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/dashboard.json'

const sources = import.meta.glob('/src/components/dashboard/ApplicationSources.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/ApplicationSources.tsx'] ?? ''

describe('the sources card view switch', () => {
  it('was found', () => {
    expect(source).toContain('export function ApplicationSources')
  })

  it('offers bars and a donut', () => {
    expect(source).toMatch(/const VIEWS = \['bars', 'donut'\] as const/)
    expect(en.sources.views).toEqual({ bars: 'Bars', donut: 'Donut' })
  })

  it('is a control in the card that sets the view', () => {
    expect(source).toMatch(
      /<Segment\s+label=\{t\('sources\.chartType'\)\}\s+options=\{views\}\s+value=\{view\}\s+onChange=\{setView\}\s+\/>/,
    )
  })

  it('draws the donut for one option and progress bars for the other', () => {
    const branch =
      /view === 'donut' \? \(\s*<Donut[\s\S]*?\) : \(\s*<ul[\s\S]*?<\/ul>/.exec(source)?.[0] ?? ''
    expect(branch).not.toBe('')
    // A bar per source, its width the source's share.
    expect(branch).toMatch(/width: `\$\{!off && total > 0 \? \(s\.value \/ total\) \* 100 : 0\}%`/)
  })
})
