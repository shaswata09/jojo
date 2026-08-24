/**
 * The person this copy of jojo belongs to.
 *
 * It lives in the store with everything else the user can type, for the reason
 * the audit found: the profile page used to hold it in route state, so the name
 * you saved was gone the moment you clicked anything in the sidebar while the
 * save bar promised it was "kept for this visit".
 *
 * Seeded with the same applicant the rest of the demo data belongs to — the
 * twelve applications, the timeline and the vault are all Shaswata Mitra's, so
 * a blank profile sitting beside them would be the odd one out.
 *
 * The email and the personal site are mock values on purpose. Demo records get
 * screenshotted into issues and pasted into bug reports, and a fixture with a
 * live inbox in it is a live inbox that strangers write to. The Scholar, GitHub
 * and LinkedIn links are real, because a link that 404s teaches a reader the
 * field is decorative.
 *
 * What matters is the other direction: clearing the records has to clear this
 * too, or an empty app still greets a new reader with a stranger's name and
 * email in the fields.
 */

import { DEFAULT_ROLES } from '../kg/core/model'
import type { Profile } from '../kg/core/model'

export type { Profile, ProfileText } from '../kg/core/model'
export { emptyProfile, profileIsBlank } from '../kg/core/profile'

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
    fullName: 'Shaswata Mitra',
    position: 'PhD candidate, Computer Science',
    location: 'Santa Clara, CA',
    email: 'mockemail@email.com',
    website: 'https://www.mockwebsite.com',
    scholar: 'https://scholar.google.com/citations?user=drsx2nkAAAAJ&hl=en',
    github: 'https://github.com/shaswata09',
    linkedin: 'https://www.linkedin.com/in/shaswatamitra',
    // Comma-separated, because that is what the scout splits on. The previous
    // values used ` · ` and `termsOf` in `fit.ts` does not split on it, so all
    // three roles were scored as one long phrase that could never match and the
    // demo's fit percentages sat at zero.
    targetRoles: 'Assistant professor',
    regions: 'US',
  },
  roles: [...DEFAULT_ROLES],
  matchTerms: [
    'machine learning',
    'cybersecurity',
    'Agentic AI',
    'representation learning',
    'NLP',
    'research',
  ],
  includeAcademia: true,
  includeIndustry: true,
})
