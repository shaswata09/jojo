/**
 * Façade. This module has no content of its own — it forwards the demo applications and the stage vocabulary to
 * `@jojo/service/data/seed`.
 *
 * It exists so the fixtures could move into the shared package without touching
 * 168 import lines across 102 files in this app, which would have buried the one
 * change worth reviewing (the fixtures leaving) under a mechanical diff. Every
 * name below is re-exported unchanged; there is no adaptation happening here and
 * none may be added — a shim that starts renaming things is a second copy of the
 * model wearing a different hat, which is exactly what this migration deleted.
 *
 * Marked for deletion. The successor spelling is `@jojo/service/data/seed`,
 * and this file goes the day the last `@/data/seed` import does.
 */
export * from '@jojo/service/data/seed'
import { STAGES as PORTABLE_STAGES, type Stage } from '@jojo/service/data/seed'

/*
 * The one name this file ADDS rather than passes through.
 *
 * It was in `@jojo/service/data/seed` and its values are Tailwind class names,
 * which the phone compiles and cannot use — a package that claims to be
 * portable was carrying six strings meaningful only in a browser. It is here
 * because this is the web-only door onto that module, so every caller's
 * `@/data/seed` import is exactly what it was.
 */
/**
 * One colour per phase.
 *
 * Draft and Closed both used --text-3, and Submitted and Screening call both
 * --info, so six stages rendered as four colours and the funnel read as though
 * it doubled back. The stage tokens are validated in index.css for contrast
 * against the bar track and for separation under colour-blind simulation.
 *
 * Whole class names, never interpolated: Tailwind scans source text, so
 * `bg-stage-${id}` would compile to no CSS at all.
 */
export const STAGE_DOT: Record<Stage, string> = {
  draft: 'bg-stage-draft',
  submitted: 'bg-stage-submitted',
  screen: 'bg-stage-screen',
  interview: 'bg-stage-interview',
  offer: 'bg-stage-offer',
  closed: 'bg-stage-closed',
}

/**
 * The stage list, with the colour web renders it in.
 *
 * An explicit export shadows the `export *` above, so `@/data/seed` gives web
 * this list and the phone gets the portable one — which is the point: the field
 * added here is a Tailwind class, and the portable list is compiled into React
 * Native where that is six strings of nothing.
 */
export const STAGES: { id: Stage; label: string; dot: string }[] = PORTABLE_STAGES.map((stage) => ({
  ...stage,
  dot: STAGE_DOT[stage.id],
}))
