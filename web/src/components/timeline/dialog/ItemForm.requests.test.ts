/**
 * Q276: a reminder filed under an application, opened from the dashboard,
 * shows a link to that application in its dialog.
 *
 * Three joins make that true, and each is pinned here by a narrow source read
 * (D20 bans mounting the dialog):
 *
 *   1. the dashboard opens the dialog on the stored item, so the form knows
 *      which record it is editing;
 *   2. the form reads the applications that record is SAVED under — not the
 *      picker, which can hold an unsaved change the link would throw away —
 *      and hands them to the application field with a way to go there;
 *   3. the field draws one link per application, to that application's page.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(
  [
    '/src/components/dashboard/OwedThisWeek.tsx',
    '/src/components/timeline/dialog/ItemForm.tsx',
    '/src/components/timeline/dialog/ApplicationLinkField.tsx',
  ],
  { query: '?raw', import: 'default', eager: true },
) as Record<string, string>

const owed = sources['/src/components/dashboard/OwedThisWeek.tsx'] ?? ''
const form = sources['/src/components/timeline/dialog/ItemForm.tsx'] ?? ''
const field = sources['/src/components/timeline/dialog/ApplicationLinkField.tsx'] ?? ''

describe('the reminder dialog from the dashboard (Q276)', () => {
  it('is opened on the stored item', () => {
    expect(owed).toMatch(
      /const edit = \(item: TimelineItem\) =>\s*open\('timelineItem', \{ mode: item\.remind \? 'reminder' : 'event', initial: item \}\)/,
    )
    expect(form).toContain('const editingId = initial?.id')
    expect(form).toContain('const stored = editingId ? get(editingId) : undefined')
  })

  it('offers the applications the record is saved under', () => {
    expect(form).toMatch(/const filedUnder = \(stored\?\.applicationIds \?\? \[\]\)\s*\.map\(\(id\) => byId\.get\(id\)\)/)
    expect(form).toMatch(/<ApplicationLinkField[\s\S]*?filedUnder=\{filedUnder\}\s*onOpen=\{closeAndGo\}/)
  })

  it('draws a link to each of them', () => {
    expect(field).toMatch(/\{onOpen && filedUnder\.length > 0 \? \(/)
    expect(field).toMatch(/filedUnder\.map\(\(app\) => \{\s*const path = appPath\(app\)/)
    expect(field).toContain('href={hrefOutsideRouter(path)}')
    expect(field).toContain('Open {displayName(app)}')
  })
})
