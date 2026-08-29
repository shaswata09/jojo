/**
 * The mapping that silently dropped the target-roles panel.
 *
 * `update()` takes a `Partial<Profile>` and `profile.set` takes a schema, and
 * between them sits `profileSetInput`, which has to name every field of the
 * record by hand. `roles` was not named here — nor in the patch the tool's
 * `run` applies — so both pages' "add a target role" wrote nothing and the
 * call still returned `ok`.
 * Measured against a real repository and tool runtime before the fix: adding
 * "Research Scientist" left the stored list at the five `DEFAULT_ROLES`.
 *
 * The first test below is the one that generalises. It does not check for
 * `roles`; it checks that NOTHING on the record is dropped, by comparing the
 * mapping's output keys against a value the compiler forces to be a complete
 * `Profile`. Add a sixth field to the record and this fails, which is the only
 * way a mapping written out by hand can stay honest.
 *
 * No component is mounted (D20) — this is why the mapping is a module-level
 * function and not an inline body in the `useCallback`.
 */

import { describe, expect, it } from 'vitest'
import type { Profile } from '../core/model'
import { profileSetInput } from './use-profile'

/**
 * Every field the record has, each with a value distinguishable from the
 * others, so a mapping that forwarded the WRONG field is caught as well as one
 * that forwarded no field.
 *
 * Typed as `Profile` rather than inferred: that annotation is what makes the
 * compiler refuse an incomplete sample, and it is the mechanism the key
 * comparison below depends on.
 */
const FULL: Profile = {
  text: {
    fullName: 'Dr A. Person',
    position: 'Postdoc',
    location: 'Zurich',
    email: 'a@example.org',
    website: 'https://example.org',
    scholar: 'https://scholar.example.org/a',
    github: 'https://github.com/a',
    linkedin: 'https://linkedin.com/in/a',
    targetRoles: 'Assistant Professor',
    regions: 'EU',
  },
  matchTerms: ['distributed systems'],
  roles: ['Assistant Professor', 'Research Scientist'],
  includeAcademia: false,
  includeIndustry: true,
}

describe('profileSetInput', () => {
  it('forwards EVERY field of the record, not the ones somebody remembered', () => {
    const input = profileSetInput(FULL)
    // Sorted set comparison, so the failure message names the missing field.
    expect(Object.keys(input).sort()).toEqual(Object.keys(FULL).sort())
    expect(input).toEqual(FULL)
  })

  it('forwards the role list on its own — the panel writes nothing else', () => {
    /*
     * The exact call `routes/Profile.tsx` and `screens/ProfileScreen.tsx` make
     * when a role is added or removed. Chips commit on click and are outside
     * the save bar, so this patch carries one key and no others.
     */
    expect(profileSetInput({ roles: ['Assistant Professor', 'Research Scientist'] })).toEqual({
      roles: ['Assistant Professor', 'Research Scientist'],
    })
    expect(profileSetInput({ roles: [] })).toEqual({ roles: [] })
  })

  it('leaves out what the caller did not mention, so one panel cannot clobber another', () => {
    // `present` is the whole reason `update({ roles })` does not blank the
    // match terms: an absent key must stay absent all the way to the tool.
    expect(profileSetInput({})).toEqual({})
    expect(Object.keys(profileSetInput({ matchTerms: ['x'] }))).toEqual(['matchTerms'])
  })
})
