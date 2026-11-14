/**
 * The diagnostic every rejection at the trust boundary becomes. See `validate.ts`.
 */

/* ------------------------------- diagnostics ------------------------------ */

/**
 * What was skipped and why, in the user's words where possible.
 *
 * `id` is the record's own id when it could be read and null when the row was
 * too broken to have one — a row with no id is the case that most needs saying
 * out loud, because it is invisible everywhere else.
 */
export type Diagnostic = {
  store: 'nodes' | 'edges'
  id: string | null
  message: string
}

export const diagnostic = (
  store: Diagnostic['store'],
  id: string | null,
  message: string,
): Diagnostic => ({
  store,
  id,
  message,
})

export type Validated<T> = { ok: true; value: T } | { ok: false; diagnostics: Diagnostic[] }
