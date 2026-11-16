import type { TourCheck, TourStep } from '@/components/tour/steps'

/**
 * The tour's decisions, without a screen: whether a task is done, which tab
 * slot a `tab:` target is, where the card sits. Pure, so they are tested
 * offline; the overlay measures and asks.
 */

/** What the app looks like right now, as far as a task can tell. */
export type TourWorld = {
  /** The focused route's name. */
  route: string | undefined
  /** The value a marked control reports, if it is mounted. */
  state: (target: string) => string | undefined
}

export function isDone(check: TourCheck, world: TourWorld): boolean {
  switch (check.kind) {
    case 'route':
      return world.route === check.route
    case 'state':
      return world.state(check.target) === check.value
  }
}

/** Whether the tour must open the step's screen first. */
export const needsRoute = (step: TourStep, route: string | undefined): boolean =>
  step.route !== undefined && step.route !== route

/** The tabs, in the order the tab bar draws them (`navigation/index.tsx`). */
export const TAB_ORDER = ['Today', 'Applications', 'Calendar', 'Vault', 'More'] as const

export type Box = { x: number; y: number; width: number; height: number }

/**
 * One tab's slot inside the measured tab bar. The tabs share the bar equally,
 * so the slot is a fifth of it — measuring the whole bar once is simpler and
 * steadier than wrapping each tab button.
 */
export function tabSlot(bar: Box, name: string): Box | null {
  const at = TAB_ORDER.indexOf(name as (typeof TAB_ORDER)[number])
  if (at < 0) return null
  const width = bar.width / TAB_ORDER.length
  return { x: bar.x + width * at, y: bar.y, width, height: bar.height }
}

export const EDGE = 12
export const GAP = 12

/**
 * Where the card goes: below the lit element if it fits, else above, else —
 * when the element is too tall to leave room on either side, a long panel on
 * a phone — over the element's own bottom edge, so the top of it, where its
 * title is, stays visible. Always inside the screen; centred when nothing is
 * lit. On a phone the card spans the width, so only the vertical is chosen.
 */
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number; top: number; bottom: number },
): { left: number; top: number } {
  const left = Math.max(EDGE, (view.width - card.width) / 2)
  const minTop = view.top + EDGE
  const maxTop = Math.max(minTop, view.height - view.bottom - EDGE - card.height)
  const clamp = (y: number) => Math.min(Math.max(y, minTop), maxTop)
  if (!target) return { left, top: clamp((view.height - card.height) / 2) }
  const below = target.y + target.height + GAP
  const above = target.y - GAP - card.height
  if (view.height - view.bottom - EDGE - below >= card.height) return { left, top: below }
  if (above >= minTop) return { left, top: above }
  return { left, top: maxTop }
}

/**
 * How far to scroll so a target's top sits near the top of the screen, which
 * leaves the lower half for the card. Zero when its top is already in the
 * upper part of the screen.
 */
export function scrollNeeded(target: Box, view: { height: number; top: number }): number {
  const inView = target.y >= view.top + EDGE && target.y <= view.height * 0.6
  return inView ? 0 : target.y - (view.top + view.height * 0.15)
}

/**
 * The part of a control that is actually on screen: a long list or the board
 * runs on under the tab bar and past the status bar, and lighting all of it
 * draws the ring through the tabs. Null when nothing of it is visible.
 */
export function visiblePart(target: Box, top: number, bottom: number): Box | null {
  const y0 = Math.max(target.y, top)
  const y1 = Math.min(target.y + target.height, bottom)
  return y1 - y0 > 4 ? { ...target, y: y0, height: y1 - y0 } : null
}
