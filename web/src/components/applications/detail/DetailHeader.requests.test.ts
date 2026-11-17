/**
 * Owner requests about the top of an application's details:
 * - Q277: the add-keyword (+) control sits right after the last keyword capsule
 *   on the same row, instead of dropping to a row of its own;
 * - Q296: the application deadline shows at the top, beside the stage.
 *
 * Both are JSX decisions, so D20 leaves a narrow source read. Which dated item
 * counts as the application deadline is a pure rule, held by
 * `components/applications/deadline.requests.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import header from './DetailHeader.tsx?raw'
import detail from '@/routes/ApplicationDetail.tsx?raw'
import en from '@/i18n/locales/en/applications.json'

describe('Q277 — the add-keyword control follows the last keyword on its row', () => {
  it('dissolves the capsules’ own box so they are items of the row, then puts the picker next', () => {
    expect(header).toMatch(
      /<div className="mt-2\.5 flex flex-wrap items-center gap-1\.5">\s*\{\/\*[\s\S]*?\*\/\}\s*<LabelChips recordId=\{labelKey\} className="contents" \/>\s*<LabelPicker recordId=\{labelKey\} \/>\s*<\/div>/,
    )
  })
})

describe('Q296 — the application deadline shows at the top of its details', () => {
  it('is handed the application deadline by the details page', () => {
    expect(detail).toMatch(
      /<DetailHeader\s+application=\{a\}\s+deadline=\{applicationDeadlineOf\(items\)\}/,
    )
  })

  it('draws it as a chip in the row with the stage, under the title', () => {
    const row = /<StageMenu[\s\S]*?<\/div>/.exec(header)?.[0] ?? ''
    expect(row).toMatch(/\{deadline \? \(\s*<Chip/)
    expect(row).toContain('i18nKey="header.deadlineChip"')
    expect(row).toContain('date: domain.shortDate(deadline.date)')
    expect(en.header.deadlineChip).toContain('Deadline {{date}}')
    expect(header.indexOf('<StageMenu')).toBeGreaterThan(header.indexOf('{displayName(a)}'))
  })
})
