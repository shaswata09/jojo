/**
 * L4 — turning a `Partial<Record>` into a tool input.
 *
 * The compatibility hooks take patches; the tools take schemas. Between them sits
 * one distinction the reducer never had to make and every one of these hooks does:
 *
 *   `{ }`                  leave the field alone
 *   `{ offer: undefined }` clear the field
 *
 * A spread reducer treated both as "write undefined", which happened to be right.
 * A schema cannot: `s.optional` drops an explicit `undefined` before the tool
 * sees it, so a patch spelling a clear that way would have been read as "not
 * mentioned" — and `revertOf` (in `routes/ApplicationDetail.tsx`) restores a
 * before-image by handing back exactly that. The undo of a stage change would
 * have put the stage back and left the offer it had just written.
 *
 * `Object.hasOwn` is the only thing that can tell the two apart, so it is the
 * one test all three helpers below are built on.
 */

/** A key the caller supplied a value for. Absent values stay absent. */
export function present<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value === undefined ? {} : { [key]: value }) as { [P in K]?: V }
}

/**
 * A nullable tool field: present-and-undefined becomes `null`, which is how
 * every tool in the catalogue spells "clear this one".
 */
export function asNull<K extends string, S extends object, F extends keyof S & string>(
  key: K,
  patch: S,
  field: F,
): { [P in K]?: NonNullable<S[F]> | null } {
  if (!Object.hasOwn(patch, field)) return {} as { [P in K]?: NonNullable<S[F]> | null }
  const value = patch[field]
  return { [key]: value ?? null } as { [P in K]?: NonNullable<S[F]> | null }
}

/**
 * A required-string tool field: present-and-undefined becomes `''`.
 *
 * The tools read a blank string as a clear — `cleared()` in `tools/application.ts`
 * — because that is what the forms already hand back for an emptied input. Two
 * spellings of empty would be two code paths, and one of them would rot.
 */
export function asText<K extends string, S extends object, F extends keyof S & string>(
  key: K,
  patch: S,
  field: F,
): { [P in K]?: string } {
  if (!Object.hasOwn(patch, field)) return {}
  const value = patch[field]
  return { [key]: typeof value === 'string' ? value : '' } as { [P in K]?: string }
}

/**
 * The undo of a write that was refused.
 *
 * Declared once at module scope rather than as a fresh `() => {}` per call, so a
 * `remove()` whose target had already gone does not hand back a new function
 * identity on every render and re-run every effect that depends on it.
 */
export const nothingToRestore = (): void => {}
