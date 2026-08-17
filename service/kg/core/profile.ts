/**
 * L1 — the empty `Profile` and the test for whether one is still empty.
 *
 * Both used to live in `src/data/profile.ts` beside `seedProfile()`, and three
 * modules under `kg/react` — `projections.ts`, `use-profile.ts`, `use-admin.ts`
 * — reached through the `@/data` alias to get them. That alias exists so
 * `repo/seed.ts` and `tools/memory.ts` can read the demo fixtures; it was
 * carrying the model's own default value instead, which is how a layer that is
 * supposed to ship on its own ended up naming a module full of one fictional
 * applicant's details.
 *
 * `src/data/profile.ts` re-exports both, keeps `seedProfile()`, and is now a
 * fixture module in fact as well as in name.
 */

import type { Profile, ProfileText } from './model'

const BLANK_TEXT: ProfileText = {
  fullName: '',
  position: '',
  location: '',
  email: '',
  website: '',
  scholar: '',
  github: '',
  linkedin: '',
  targetRoles: '',
  regions: '',
}

/**
 * A fresh object on every call rather than an exported constant.
 *
 * The result goes straight into a node's `props` — as the projection's fallback
 * when no profile node exists — and props are patched in place, so a shared
 * object would let one session's edits reach the next reset. That is why this is
 * a function and not a const; it was originally written against a reducer that
 * no longer exists, and the mechanism changed while the hazard did not.
 * `seedProfile()` in `src/data/profile.ts` is a function for the same reason.
 *
 * Both switches start on: an untouched profile filters nothing out, and a scout
 * that silently excluded half the boards would be a setting nobody chose.
 */
export const emptyProfile = (): Profile => ({
  text: { ...BLANK_TEXT },
  matchTerms: [],
  includeAcademia: true,
  includeIndustry: true,
})

/**
 * Whether anything has been filled in.
 *
 * The two switches are settings rather than content, so they are not counted:
 * a profile whose fields are all blank is an empty profile no matter which way
 * they point. Read by Settings' "is this store empty" signal and by the
 * Transfer manifest, which must not offer to move a record with nothing in it.
 */
export const profileIsBlank = (profile: Profile) =>
  profile.matchTerms.length === 0 &&
  Object.values(profile.text).every((value) => value.trim() === '')
