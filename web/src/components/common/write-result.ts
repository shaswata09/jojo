/**
 * What a card says when the write it just made was refused.
 *
 * The data hooks hand back the tool's result (`{ ok: true, … }` or
 * `{ ok: false, errors }`). A card that toasted "Saved" straight after the call
 * without looking said so over refusals too — "Cannot be blank" landed and the
 * screen announced success. Each such card now asks this first, and shows the
 * refusal in the tool's own words instead of its success line.
 *
 * Takes `unknown`-ish input on purpose: a hook that still returns nothing reads
 * as "not refused", so a card can adopt this before its hook does.
 */

export type WriteResult =
  { ok: true } | { ok: false; errors: readonly { message: string }[] } | null | undefined | void

export type RefusalToast = { title: string; description: string; tone: 'danger' }

/** The toast for a refused write, or `null` when it went through. */
export function refusalToast(result: WriteResult): RefusalToast | null {
  if (!result || result.ok) return null
  return {
    title: 'That did not save',
    description: result.errors[0]?.message ?? 'The change was refused.',
    tone: 'danger',
  }
}

/**
 * `refusalToast`, shown: true when the write was refused and the toast is up,
 * so a card can write `if (announceRefusal(update(…), toast)) return` and skip
 * its success line.
 */
export function announceRefusal(
  result: WriteResult,
  toast: (options: RefusalToast) => void,
): boolean {
  const refused = refusalToast(result)
  if (refused) toast(refused)
  return refused !== null
}
