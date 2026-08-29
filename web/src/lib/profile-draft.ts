/**
 * What the profile form shows, and whether the save bar is up.
 *
 * Two lines of a component, extracted because they were wrong and because a
 * component cannot be tested here (D20) — the same reason `nextContextThrough`
 * lives beside the walk that creates its mismatch rather than inside the hook
 * that needs it.
 *
 * THE DEFECT. `routes/Profile.tsx` held the form as `useState(profile.text)`,
 * and a `useState` initialiser reads its argument once, at mount. This page is
 * not the only writer of that record: `profile.text.set` — "Edit one profile
 * field" — is a non-internal tool, so the app-wide Spotlight palette offers it a
 * generated form on ⌘K over every route, `/profile` included; `memory.clear`
 * blanks the same fields, and a restore replaces them wholesale.
 *
 * Measured with the tool run against a live store: the record went from "Alex
 * Rivera" to "Dr Alex Rivera", `profile.text` came back as a new object with the
 * new value, and the page went on rendering the mount-time copy. Worse than
 * stale — `dirty` compares the frozen copy against the store, so the sticky bar
 * appeared announcing "Unsaved changes" that nobody had typed, and Save wrote
 * the old name back over the new one in a single `profile.set`.
 *
 * THE SHAPE. There is no second copy of the record any more: the edit in
 * progress is `null` until somebody types, and a form with no edit in progress
 * simply renders the store. That is what makes a change from elsewhere appear
 * on screen rather than being shadowed by a copy of what used to be there.
 */

import type { ProfileText } from '@jojo/service/data/profile'

/**
 * Whether two profile records say the same thing.
 *
 * Over the union of both key sets rather than one of them. Comparing the keys
 * of the stored copy alone is a blind spot exactly when it matters — a record
 * written by an older build, or a blank one, has fewer of them.
 */
export function sameText(a: ProfileText, b: ProfileText): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]) as Set<keyof ProfileText>
  for (const key of keys) if (a[key] !== b[key]) return false
  return true
}

export type ProfileForm = {
  /** What the ten inputs render. */
  fields: ProfileText
  /** Whether there is something to save, and so whether the bar is shown. */
  dirty: boolean
}

/**
 * The form, given the edit in progress and the store's current copy.
 *
 * `edit` is null while nobody has typed since the last Save or Discard, and
 * that is the whole fix: a clean form is a view of the record, so a write from
 * anywhere else shows up in it instead of raising a save bar over it.
 *
 * A form with something typed in it keeps what was typed, even when the record
 * moves underneath — throwing away half a sentence somebody is in the middle of
 * is worse than showing them a conflict they can Discard.
 */
export function profileForm(edit: ProfileText | null, saved: ProfileText): ProfileForm {
  if (edit === null) return { fields: saved, dirty: false }
  return { fields: edit, dirty: !sameText(edit, saved) }
}
