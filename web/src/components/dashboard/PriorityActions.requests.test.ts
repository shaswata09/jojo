/**
 * Owner requests about the dashboard's Needs a decision carousel.
 *
 * Q034: each card carries a short description and a tag chip.
 * Q280: overdue applications are among the decisions.
 * Q281: the cards run oldest to newest, left to right, the latest at the end.
 *
 * The two rules are pure and already tested in
 * `service/kg/react/use-priority.test.ts`: `overdueApplicationsOn` finds the
 * overdue applications and `chronological` orders the deck. What those tests
 * cannot see is whether the deck uses them, so this pins the joins: the hook
 * makes an Overdue card from `overdueApplicationsOn`, and the carousel lays
 * the deck out through `chronological`. D20 bans mounting, so these are
 * narrow source reads.
 */

import { describe, expect, it } from 'vitest'

const sources = import.meta.glob('/src/components/dashboard/PriorityActions.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const source = sources['/src/components/dashboard/PriorityActions.tsx'] ?? ''

// Read as text through a `?raw` glob, the one form check-no-copies allows for
// reaching the service source from the app: it instantiates no module.
const hookSources = import.meta.glob('../../../../service/kg/react/use-priority.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>
const hookSource = Object.values(hookSources)[0] ?? ''

/** The body of `usePriorityActions`, the hook that builds the deck. */
const hook = /export function usePriorityActions\([\s\S]*$/.exec(hookSource)?.[0] ?? ''

/** The body of `DecisionCard`. */
const card = /function DecisionCard\([\s\S]*?\n\}\n/.exec(source)?.[0] ?? ''

describe('a decision card (Q034)', () => {
  it('was found', () => {
    expect(card).toContain('URGENCY_BORDER[action.urgency]')
  })

  it('shows a tag chip and a short description under its headline', () => {
    expect(card).toMatch(/<Chip [^>]*>\s*\{action\.kindLabel\}\s*<\/Chip>/)
    expect(card).toMatch(/<p className="[^"]*line-clamp-2[^"]*">\{action\.context\}<\/p>/)
  })
})

describe('overdue applications in the deck (Q280)', () => {
  it('are found by the tested rule', () => {
    expect(hook).toMatch(/const overdue = overdueApplicationsOn\(today, all, items,/)
  })

  it('each become an Overdue card', () => {
    expect(hook).toMatch(/overdue\.map\(\s*\(\{ application: a, item \}\)[\s\S]*?kindLabel: 'Overdue'/)
  })

  it('reach the dashboard deck', () => {
    expect(source).toContain('const actions = usePriorityActions()')
  })
})

describe('the order of the carousel (Q281)', () => {
  it('is the chronological order, latest last', () => {
    expect(source).toMatch(/<DecisionTimeline\s+actions=\{chronological\(actions\)\}/)
  })

  it('opens at the start, so the oldest is on the left', () => {
    expect(source).toContain('aria-label="Decisions, earliest first"')
    // Nothing scrolls the track to its end on mount.
    expect(source).not.toMatch(/scrollLeft\s*=\s*[^=]/)
    expect(source).not.toMatch(/scrollTo\(/)
  })
})
