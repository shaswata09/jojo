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

/** Every free-text field on the profile page, in one record. */
export type ProfileText = {
  fullName: string
  position: string
  location: string
  email: string
  website: string
  scholar: string
  github: string
  linkedin: string
  targetRoles: string
  regions: string
}

export type Profile = {
  text: ProfileText
  /**
   * What the scout scores a posting against. Not the global keyword system —
   * see the panel copy, which has to keep the two apart for the reader too.
   */
  matchTerms: string[]
  includeAcademia: boolean
  includeIndustry: boolean
}

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
 * Fresh objects on every call rather than exported constants.
 *
 * `seedState()` and `emptyState()` hand their result straight to the reducer,
 * and a shared object would let one session's edits reach the next reset — the
 * arrays elsewhere in the seed are copied with a spread for the same reason.
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
