/**
 * What the page organiser is going to do, as data.
 *
 * The organiser edits a PLAN and writes the PDF once, at the end — it never
 * rewrites the document per click. Two reasons, and neither is performance.
 * Re-saving on every rotation means the bytes a person is looking at are a
 * different generation from the ones they opened, so an undo has nothing to go
 * back to; and pdf-lib's page objects carry their document with them, so a
 * half-applied sequence of edits is not a thing that can be inspected. A plan
 * can be, which is why every rule below is checkable without a PDF.
 *
 * `source` is an index into the ORIGINAL document and never changes meaning.
 * Deleting page 2 shifts positions but not sources, so a plan always says
 * exactly which original page each slot came from, however much it was moved.
 */

export const ROTATIONS = [0, 90, 180, 270] as const
export type Rotation = (typeof ROTATIONS)[number]

export type PlannedPage = { readonly source: number; readonly rotation: Rotation }
export type PagePlan = readonly PlannedPage[]

/** The document as it arrived: every page, in order, unturned. */
export function planFor(pageCount: number): PagePlan {
  if (!Number.isInteger(pageCount) || pageCount < 0) return []
  return Array.from({ length: pageCount }, (_, source) => ({ source, rotation: 0 as Rotation }))
}

/**
 * Adds `delta` degrees, landing on one of the four quarter turns.
 *
 * Takes any multiple of 90, positive or negative, because the buttons are
 * "turn left" and "turn right" and the second of those is -90. A value that is
 * not a quarter turn is rounded to the nearest one rather than rejected: this
 * is called from a click handler, and there is no sensible way to report a
 * failure from one.
 */
export function turn(rotation: Rotation, delta: number): Rotation {
  const quarters = Math.round((rotation + delta) / 90)
  const index = ((quarters % 4) + 4) % 4
  return ROTATIONS[index] ?? 0
}

export function rotatePage(plan: PagePlan, index: number, delta: number): PagePlan {
  if (!plan[index]) return plan
  return plan.map((page, at) =>
    at === index ? { ...page, rotation: turn(page.rotation, delta) } : page,
  )
}

/**
 * Moves one page to another position, carrying its rotation with it.
 *
 * Clamped rather than refused: this is driven by up/down buttons at the ends of
 * a list, where the natural thing for "up" on the first row is to do nothing.
 */
export function movePage(plan: PagePlan, from: number, to: number): PagePlan {
  return moveItem(plan, from, to)
}

/**
 * The same move, for any list. The merge tool reorders its sources with it.
 *
 * Generic because the rule — take it out, clamp, put it back — is the same for
 * a page and for a document, and the version that was written twice had a
 * clamp in one copy and not the other.
 */
export function moveItem<T>(list: readonly T[], from: number, to: number): readonly T[] {
  const item = list[from]
  if (item === undefined) return list
  const target = Math.max(0, Math.min(list.length - 1, to))
  if (target === from) return list
  const rest = [...list.slice(0, from), ...list.slice(from + 1)]
  return [...rest.slice(0, target), item, ...rest.slice(target)]
}

export function removePage(plan: PagePlan, index: number): PagePlan {
  if (!plan[index]) return plan
  return plan.filter((_, at) => at !== index)
}

/** Keeps only the given ORIGINAL pages, in the order given. See `parsePageRange`. */
export function keepOnly(plan: PagePlan, sources: readonly number[]): PagePlan {
  const bySource = new Map(plan.map((page) => [page.source, page]))
  return sources.flatMap((source) => {
    const page = bySource.get(source)
    return page ? [page] : []
  })
}

/**
 * Whether saving would produce anything different from what was opened.
 *
 * Drives whether Save is offered at all. Without it the tool invites a person
 * to write a new copy of a document they have not changed, which is how a vault
 * fills up with four identical files.
 */
export function planChanged(plan: PagePlan, pageCount: number): boolean {
  if (plan.length !== pageCount) return true
  return plan.some((page, at) => page.source !== at || page.rotation !== 0)
}
