/**
 * The web import path for the lit-selection rule.
 *
 * The rule moved to `@jojo/service/core/label-selection` because BOTH apps
 * need it and only this one had it. Mobile's keyword filter read the raw
 * `selected` set, so deleting a keyword through any path that does not run the
 * toast's Undo — Reset the demo data, Clear every record, Load demo data —
 * left a filter lit by an id that no longer exists and emptied every list.
 * Driven on a real device before the move: "0 shown, 12 total", with the chip
 * row gone entirely.
 *
 * Re-exported rather than re-imported at each call site so this app's existing
 * imports kept their line, the same move `src/lib/undo.ts` records.
 */

export { litSelection } from '@jojo/service/core/label-selection'
