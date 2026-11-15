import { describe, expect, it } from 'vitest'
import panel from '@/components/common/Panel.tsx?raw'
import owedThisWeek from '@/components/dashboard/OwedThisWeek.tsx?raw'
import priorityActions from '@/components/dashboard/PriorityActions.tsx?raw'
import applicationFields from '@/components/applications/dialog/ApplicationFields.tsx?raw'
import itemForm from '@/components/timeline/dialog/ItemForm.tsx?raw'
import dialog from '@/components/ui/dialog.tsx?raw'

/**
 * Q048 and Q132 — a scrollbar sits on its card's edge, not a padding's width
 * inside it. Protected design (the glass scrollbars).
 *
 * The mechanism is one rule: a scroller inside a padded surface cancels that
 * padding with a negative margin and puts the same padding back inside, so the
 * content stays where it was and only the bar moves. What is pinned here is that
 * each bleed matches the padding it escapes — a mismatch is the bar floating in
 * from the edge again. Source reads (D20).
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** `{ 'sm:px': '5', px: '4', … }` for every padding and negative-margin utility in a class string. */
const spacing = (classes: string) => {
  const out: Record<string, string> = {}
  for (const m of classes.matchAll(/(?:^|\s)((?:sm:|lg:|xl:)?)(-?)(p|m)([xyblrt]?)-(\d+(?:\.\d+)?)\b/g)) {
    const [, bp, neg, kind, side, size] = m
    out[`${bp}${neg}${kind}${side}`] = size!
  }
  return out
}

/** Every negative margin is matched by the same padding on the same side and breakpoint. */
const bleedsCleanly = (classes: string, sides: string[]) => {
  const s = spacing(classes)
  for (const side of sides) {
    for (const bp of ['', 'sm:']) {
      const margin = s[`${bp}-m${side}`]
      if (margin === undefined) continue
      expect(s[`${bp}p${side}`], `${bp}p${side} in "${classes}"`).toBe(margin)
    }
  }
  return s
}

const panelPadding = spacing(/className=\{cn\('surface rounded-lg ([^']*)'/.exec(strip(panel))?.[1] ?? '')

describe('a scroller on a card’s edge (Q048)', () => {
  it('reads the panel’s padding', () => {
    expect(panelPadding).toMatchObject({ px: '4', py: '4', 'sm:px': '5', 'sm:py': '5' })
  })

  it('PanelScroll cancels exactly the panel’s padding, sides and bottom', () => {
    const code = strip(panel)
    const sides = bleedsCleanly(/: '(-mx-4 px-4 sm:-mx-5 sm:px-5)'/.exec(code)?.[1] ?? '', ['x'])
    expect(sides['-mx']).toBe(panelPadding.px)
    expect(sides['sm:-mx']).toBe(panelPadding['sm:px'])
    const bottom = bleedsCleanly(/: '(-mb-4 pb-4 sm:-mb-5 sm:pb-5)'/.exec(code)?.[1] ?? '', ['b'])
    expect(bottom['-mb']).toBe(panelPadding.py)
    expect(bottom['sm:-mb']).toBe(panelPadding['sm:py'])
  })

  it('Owed this week puts its bar on the card’s right and bottom edges', () => {
    const scroller = /className="(-mx-4 -mb-4 max-h-\[30rem\] overflow-x-hidden overflow-y-auto[^"]*)"/.exec(
      strip(owedThisWeek),
    )?.[1]
    expect(scroller).toBeDefined()
    const s = bleedsCleanly(scroller!, ['x', 'b'])
    expect(s['-mx']).toBe(panelPadding.px)
    expect(s['sm:-mx']).toBe(panelPadding['sm:px'])
    // In the absolute lg layout the bleed is an inset, matched to the same 20px.
    expect(scroller).toMatch(/\blg:-inset-x-5\b/)
    expect(scroller).toMatch(/\blg:px-5\b/)
  })

  it('the reminder carousel puts its bar on the card’s bottom edge', () => {
    const code = strip(priorityActions)
    const scroller = /className="([^"]*overflow-x-auto[^"]*)"/.exec(code)?.[1] ?? ''
    expect(scroller).not.toBe('')
    const s = bleedsCleanly(scroller, ['x', 'b'])
    expect(s['-mb'] ?? s['sm:-mb']).toBeDefined()
  })
})

describe('a modal’s scrollbar touches its right edge (Q132)', () => {
  it('reads the dialog’s padding', () => {
    expect(strip(dialog)).toMatch(/rounded-xl bg-popover p-4 /)
  })

  it.each([
    ['the new-application form', applicationFields],
    ['the event form', itemForm],
  ])('%s cancels it', (_name, src) => {
    const scroller = /className="(-mx-4 [^"]*overflow-y-auto[^"]*)"/.exec(strip(src))?.[1] ?? ''
    expect(scroller).not.toBe('')
    expect(spacing(scroller)).toMatchObject({ '-mx': '4', px: '4' })
  })
})
