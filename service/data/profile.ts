/**
 * The person this copy of jojo belongs to.
 *
 * It lives in the store with everything else the user can type, for the reason
 * the audit found: the profile page used to hold it in route state, so the name
 * you saved was gone the moment you clicked anything in the sidebar while the
 * save bar promised it was "kept for this visit".
 *
 * Seeded with the same applicant the rest of the demo data belongs to — the
 * twelve applications, the timeline and the vault are all one invented
 * applicant's, so
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
/*
 * A FICTIONAL applicant, and every field of them.
 *
 * This used to be the maintainer's own name, city and live Google Scholar,
 * GitHub and LinkedIn URLs — seeded into every fresh install and every fork.
 * Two things were wrong with that. A stranger's first launch showed somebody
 * else's identity as though it were theirs; and `draft/template.ts` substitutes
 * `fullName` into every cover letter, so a demo draft signed off as a real
 * person who had not written it.
 *
 * The email and website were already mocked with that reasoning written down —
 * the name and the three profile links simply had not followed.
 *
 * The links point at `example.com`, which is reserved by RFC 2606 precisely so
 * that documentation cannot accidentally name somebody real.
 */
export const seedProfile = (): Profile => ({
  text: {
    fullName: 'Alex Rivera',
    position: 'PhD candidate, Computer Science',
    location: 'Santa Clara, CA',
    email: 'mockemail@email.com',
    website: 'https://www.mockwebsite.com',
    scholar: 'https://scholar.example.com/citations?user=demo',
    github: 'https://github.example.com/alexrivera',
    linkedin: 'https://www.linkedin.example.com/in/alexrivera',
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
