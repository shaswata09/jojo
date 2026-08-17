/**
 * The person this copy of jojo belongs to.
 *
 * It lives in the store with everything else the user can type, for the reason
 * the audit found: the profile page used to hold it in route state, so the name
 * you saved was gone the moment you clicked anything in the sidebar while the
 * save bar promised it was "kept for this visit".
 *
 * Seeded with the same fictional applicant the rest of the demo data belongs
 * to — the twelve applications, the timeline and the vault are all Alex
 * Rahman's, so a blank profile sitting beside them would be the odd one out.
 * What matters is the other direction: clearing the records has to clear this
 * too, or an empty app still greets a new reader with a stranger's name and
 * email in the fields.
 */

import type { Profile } from '@/kg/core/model'

export type { Profile, ProfileText } from '@/kg/core/model'
export { emptyProfile, profileIsBlank } from '@/kg/core/profile'

/**
 * Fresh objects on every call rather than exported constants.
 *
 * The result goes straight into a node's `props` — `seedProfile()` through
 * `repo/seed.ts` and `memory.reset` — and props are patched in place, so a
 * shared object would let one session's edits reach the next reset. That is why
 * these are functions and not consts; it was originally written against a
 * reducer that no longer exists, and the mechanism changed while the hazard did
 * not.
 */
export const seedProfile = (): Profile => ({
  text: {
    fullName: 'Alex Rahman',
    position: 'PhD candidate, Computer Science',
    location: 'Lubbock, TX (open to relocate)',
    email: 'alex@university.edu',
    website: 'https://alexrahman.dev',
    scholar: 'https://scholar.google.com/citations?user=xxxx',
    github: 'https://github.com/alexr',
    linkedin: 'https://linkedin.com/in/alexr',
    targetRoles: 'Assistant professor (TT) · Research scientist · ML engineer',
    regions: 'Texas · remote · open to US-wide for TT',
  },
  matchTerms: ['machine learning systems', 'distributed training', 'efficient inference', 'MLOps'],
  includeAcademia: true,
  includeIndustry: true,
})
