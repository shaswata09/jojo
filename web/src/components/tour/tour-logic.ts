import type { TourCheck, TourStep } from '@/components/tour/steps'

/**
 * The tour's decisions, without a DOM: whether a task is done, where the card
 * sits beside what it points at. Pure, so they are tested offline (D20); the
 * overlay measures the page and asks.
 */

/** What the page looks like right now, as far as a task can tell. */
export type TourWorld = {
  pathname: string
  search: string
  /** Is there an element matching this CSS selector on the page? */
  has: (selector: string) => boolean
  /** Gestures the mascot has played since the step opened. */
  plays: number
}

/** Whether the step's hands-on task has been done. */
export function isDone(check: TourCheck, world: TourWorld): boolean {
  switch (check.kind) {
    case 'route':
      return onRoute(check.path, world.pathname, world.search)
    case 'query':
      return new URLSearchParams(world.search).get(check.param) === check.value
    case 'open':
      return world.has(mark(check.target))
    case 'closed':
      return !world.has(mark(check.target))
    case 'marked':
      return world.has(`${mark(check.target)}[${check.attr}]`)
    case 'mascot':
      return world.plays > 0
  }
}

/** The selector for an element carrying a `data-tour` mark. */
export const mark = (name: string) => `[data-tour="${name.replace(/["\\]/g, '\\$&')}"]`

/** Paths compared without a trailing slash: `/applications/` is `/applications`. */
export function samePath(a: string, b: string): boolean {
  const trim = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)
  return trim(a) === trim(b)
}

/**
 * Whether the tour has to take the reader to the step's page first. A step
 * with no page of its own is wherever they are; one whose task IS reaching a
 * page must not be taken there, or the task would do itself.
 */
export function needsRoute(step: TourStep, pathname: string, search = ''): string | null {
  if (!step.route) return null
  return onRoute(step.route, pathname, search) ? null : step.route
}

/**
 * On `route` — its path, and every query value it names (`/vault?tool=files`
 * is the Files tab). Other query values the reader has set are left alone.
 */
export function onRoute(route: string, pathname: string, search: string): boolean {
  const [path = '', query = ''] = route.split('?')
  if (!samePath(pathname, path)) return false
  const have = new URLSearchParams(search)
  return [...new URLSearchParams(query)].every(([k, v]) => have.get(k) === v)
}

export type Box = { left: number; top: number; width: number; height: number }
export type Side = 'right' | 'bottom' | 'left' | 'top'

/** Room left between the card and the window's edge. */
export const EDGE = 12
/** Between the lit element and the card. */
export const GAP = 14

/**
 * Where the card goes: on the preferred side of the target if it fits, else
 * the side with the most room, and always inside the window. With no target
 * (or one that is off the page) it is centred.
 */
export function placeCard(
  target: Box | null,
  card: { width: number; height: number },
  view: { width: number; height: number },
  prefer: Side = 'bottom',
): { left: number; top: number; side: Side | 'center' } {
  const clampX = (x: number) =>
    Math.min(Math.max(x, EDGE), Math.max(EDGE, view.width - card.width - EDGE))
  const clampY = (y: number) =>
    Math.min(Math.max(y, EDGE), Math.max(EDGE, view.height - card.height - EDGE))
  if (!target || target.width <= 0 || target.height <= 0) {
    return {
      left: clampX((view.width - card.width) / 2),
      top: clampY((view.height - card.height) / 2),
      side: 'center',
    }
  }
  const room: Record<Side, number> = {
    right: view.width - (target.left + target.width) - GAP - EDGE,
    left: target.left - GAP - EDGE,
    bottom: view.height - (target.top + target.height) - GAP - EDGE,
    top: target.top - GAP - EDGE,
  }
  const need: Record<Side, number> = {
    right: card.width,
    left: card.width,
    bottom: card.height,
    top: card.height,
  }
  const order: Side[] = [
    prefer,
    ...(['right', 'bottom', 'left', 'top'] as Side[]).filter((s) => s !== prefer),
  ]
  const fits = order.find((s) => room[s] >= need[s])
  const side =
    fits ?? order.reduce((best, s) => (room[s] - need[s] > room[best] - need[best] ? s : best))
  const midX = target.left + target.width / 2 - card.width / 2
  const midY = target.top + target.height / 2 - card.height / 2
  switch (side) {
    case 'right':
      return { left: clampX(target.left + target.width + GAP), top: clampY(midY), side }
    case 'left':
      return { left: clampX(target.left - GAP - card.width), top: clampY(midY), side }
    case 'bottom':
      return { left: clampX(midX), top: clampY(target.top + target.height + GAP), side }
    case 'top':
      return { left: clampX(midX), top: clampY(target.top - GAP - card.height), side }
  }
}

/** A box grown by `pad` on every side — the lit area is a little larger than its element. */
export const padded = (b: Box, pad: number): Box => ({
  left: b.left - pad,
  top: b.top - pad,
  width: b.width + pad * 2,
  height: b.height + pad * 2,
})
