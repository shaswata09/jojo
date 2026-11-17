/**
 * Owner requests about what an application's details panel carries, and in
 * what order. The rules underneath each card are held in the service; what is
 * read here is that the card is on the record and wired to them (D20: no
 * component is mounted, so this is a narrow source read).
 *
 * - Q253: Tailor materials sits directly below How you fit. The writes are
 *   held by `service/kg/tools/tailor.test.ts`, the marks by
 *   `service/kg/agent/tailor-material.test.ts`.
 * - Q262: each application has a checklist the agent drafts and the person
 *   adds to, ticks and deletes from. The rules are held by
 *   `service/kg/tools/checklist.test.ts` and `service/kg/core/checklist.test.ts`.
 * - Q264: stage dates are shown, and a date typed in is written through the
 *   rule that overwrites (`setStageDate`), not the one a move uses. The move's
 *   stamp is held by `service/kg/tools/tools.test.ts`.
 */

import { describe, expect, it } from 'vitest'
import applicationsEn from '@/i18n/locales/en/applications.json'
import detail from './ApplicationDetail.tsx?raw'
import checklist from '@/components/applications/detail/ChecklistPanel.tsx?raw'
import stageDates from '@/components/applications/detail/StageDatesPanel.tsx?raw'

/** The cards in the order the page renders them. */
const order = [...detail.matchAll(/<([A-Z][A-Za-z]*Panel)\b/g)].map((m) => m[1])

describe('Q253 — Tailor materials sits below How you fit', () => {
  it('renders the tailored materials card straight after the fit card', () => {
    const fit = order.indexOf('FitPanel')
    expect(fit).toBeGreaterThanOrEqual(0)
    expect(order[fit + 1]).toBe('TailoredPanel')
  })
})

describe('Q262 — a checklist card per application', () => {
  it('is on every application', () => {
    expect(detail).toContain('<ChecklistPanel applicationId={a.id} />')
  })

  it('lets the agent draft it, and the person add, tick and delete steps', () => {
    expect(checklist).toMatch(/<Button size="sm" variant="outline" onClick=\{c\.draft\}>/)
    expect(checklist).toContain('const result = c.add(text)')
    expect(checklist).toContain('onClick={() => c.tick(item.id, item.doneOn === undefined)}')
    expect(checklist).toMatch(/onSelect=\{\(\) => onDelete\(item\)\}>\s*\{t\('common\.delete'\)\}/)
    expect(applicationsEn.common.delete).toBe('Delete')
    expect(checklist).toContain('const done = c.remove(item.id)')
  })
})

describe('Q264 — the date of each stage is shown and can be corrected', () => {
  it('is on every application', () => {
    expect(detail).toContain('<StageDatesPanel application={a} />')
  })

  it('shows each stage’s date, submitted included', () => {
    // Through a draft (web-2): the field shows the stored date until somebody
    // types, and holds what they type rather than snapping back to it.
    expect(stageDates).toMatch(
      /const on = stageDateOf\(a, stage\)[\s\S]*?<StageDateInput\s+stored=\{on\}/,
    )
    expect(stageDates).toContain("const [draft, setDraft] = useState(stored ?? '')")
    expect(stageDates).toMatch(/<Input\s+type="date"\s+value=\{draft\}/)
  })

  it('writes a typed date through the rule that overwrites', () => {
    expect(stageDates).toContain('onCommit={(typed) => commit(stage, typed)}')
    expect(stageDates).toContain('update(a.id, setStageDate(a, stage, on))')
  })
})
