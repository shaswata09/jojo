/**
 * Owner requests about the people on an application's details:
 * - Q279: from the open application the person can tag someone as point of
 *   contact or recommender. The write itself is held by
 *   `service/kg/tools/tools.test.ts` ("names a person on one job with a role,
 *   leaving their other jobs alone"); what is read here is that the panel
 *   offers both roles and files the person on THIS application with the one
 *   chosen.
 * - Q283: a person's name keeps its room up to a fixed number of characters,
 *   and the affiliation beside it is what gets cut.
 *
 * JSX wiring and classes, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import { CONTACT_ROLE_LABEL, CONTACT_ROLE_VALUES } from '@jojo/service/core/model'
import panel from './PeoplePanel.tsx?raw'
import detail from '@/routes/ApplicationDetail.tsx?raw'

describe('Q279 — tag a person as point of contact or recommender from the details', () => {
  it('is on the open application', () => {
    expect(detail).toContain('<PeoplePanel applicationId={a.id} />')
  })

  it('has exactly the two roles to choose from', () => {
    expect([...CONTACT_ROLE_VALUES].sort()).toEqual(['contact', 'recommender'])
    expect(CONTACT_ROLE_LABEL.contact.toLowerCase()).toContain('contact')
    expect(CONTACT_ROLE_LABEL.recommender.toLowerCase()).toContain('recommender')
  })

  it('files someone already in the Vault on this application with the chosen role', () => {
    expect(panel).toContain('filePerson(p.id, applicationId, role)')
  })

  it('creates someone new already named on this application with the chosen role', () => {
    expect(panel).toMatch(
      /addPerson\(\{\s*name: trimmed,\s*applicationIds: \[applicationId\],\s*roles: \{ \[applicationId\]: role \},/,
    )
  })

  it('changes or clears the role of someone already on it', () => {
    expect(panel).toContain('const changed = filePerson(p.id, applicationId, next)')
    expect(panel).toMatch(/\{CONTACT_ROLE_VALUES\.map\(\(v\) => \(\s*<option key=\{v\} value=\{v\}>/)
  })
})

describe('Q283 — the name keeps its room and the affiliation gives way', () => {
  const row = /function NameThenPlace\([\s\S]*?\n\}\n/.exec(panel)?.[0] ?? ''

  it('caps the name at a fixed character width, never shrinking it below that', () => {
    expect(panel).toMatch(/const NAME_ROOM = 'max-w-\[min\(\d+ch,100%\)\]'/)
    expect(row).toContain("<span className={cn(NAME_ROOM, 'shrink-0 truncate', nameClass)}>{name}</span>")
  })

  it('lets the affiliation take what is left and truncate first', () => {
    expect(row).toMatch(/<span className="min-w-0 flex-1 truncate[^"]*">\{place\}<\/span>/)
  })

  it('draws every person on the application through that row, with their affiliation', () => {
    expect(panel).toContain('place={p.affiliation}')
  })
})
