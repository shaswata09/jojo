/**
 * The web import path for the Undo a card wires by hand.
 *
 * The implementation is `@jojo/service/react/undo`. It moved down when
 * `use-tool.ts` needed the same guard — a hook written for cards to migrate
 * to, which none have yet — because `check-platform.mjs` bans
 * `kg/react -> @/lib`:
 * `src/lib` is jojo's web app, and the shared layer reaching into it is how
 * the toast context's DOM types got below the seam the first time. Nothing in
 * the undo rule is web-only, so the module went down rather than the ban being
 * argued with.
 *
 * Re-exported rather than re-imported at each call site so the four cards that
 * fire these toasts — the profile save, a file note, and the two scout
 * promotions — kept their import line when it moved. Nothing else belongs in
 * here: if you are adding a helper, it is either portable, in which case it goes
 * next to the implementation, or it names a DOM type, in which case `kg/react`
 * must not be able to see it at all.
 *
 * Carries only what the web app imports THROUGH it. `supersededToast` and the
 * three types were re-exported here too and had no consumer on this path —
 * `supersededToast` has exactly one caller and it is inside the implementation.
 * A shim that re-exports more than its callers use reads as a public surface,
 * which is the opposite of what this file is for: anything reached directly
 * from `@jojo/service/react/undo` should stay reached that way.
 */

export { undoableWith, useUndoable } from '@jojo/service/react/undo'
