/**
 * Q284: every field the person fills in on the application form is shown on the
 * application's details — the Posting ID was saved and never displayed.
 *
 * The form's fields are read off `formFrom()`, so a field added to the form
 * without a place on the record fails here by name: it is missing from
 * `SHOWN_AT`, which the `satisfies` clause also makes a compile error. Each
 * entry points at the line that puts that field on screen (D20: a narrow source
 * read, since the details are JSX).
 */

import { describe, expect, it } from 'vitest'
import { formFrom } from '@/components/applications/dialog/form-state'
import type { FormState } from '@/components/applications/dialog/form-state'
import facts from './DetailFacts.tsx?raw'
import header from './DetailHeader.tsx?raw'
import note from './NotePanel.tsx?raw'
import en from '@/i18n/locales/en/applications.json'
import detail from '@/routes/ApplicationDetail.tsx?raw'

const FILES = { facts, header, note, detail } as const

/** Where each form field is drawn on the record, and the line that draws it. */
const SHOWN_AT = {
  org: ['facts', /label: t\('facts\.employer'\),[\s\S]*?\ba\.org\b/],
  // The title is `displayName(a)`, which is "org — role".
  role: ['header', /\{displayName\(a\)\}/],
  roleTag: ['header', /<Chip>\{a\.roleTag\}<\/Chip>/],
  stage: ['header', /<StageMenu\s+value=\{a\.stage\}/],
  // Shown in the language on screen; the stored value is English (review 3, i18n-1).
  source: [
    'facts',
    /label: t\('facts\.source'\),\s+value: a\.source === undefined \? undefined : domain\.source\(a\.source\)/,
  ],
  url: ['facts', /label: t\('facts\.posting'\),\s*value: a\.url \?/],
  postingId: ['facts', /\{ label: t\('facts\.postingId'\), value: a\.postingId \}/],
  confirmationRef: [
    'facts',
    /\{ label: t\('facts\.confirmationRef'\), value: a\.confirmationRef \}/,
  ],
  location: ['facts', /\{ label: t\('facts\.location'\), value: a\.location \}/],
  comp: ['facts', /\{ label: t\('facts\.compensation'\), value: a\.comp\b/],
  deadline: ['detail', /deadline=\{applicationDeadlineOf\(items\)\}/],
  note: ['note', /htmlFromNote\(a\.note,/],
  // The note's formatting (Q268), drawn by the same panel from the node.
  noteFormat: ['note', /htmlFromNote\(a\.note, stored\)/],
} as const satisfies Record<keyof FormState, readonly [keyof typeof FILES, RegExp]>

describe('Q284 — every field from the form is shown on the record', () => {
  it('knows where every form field is shown, and no field is left out', () => {
    expect(Object.keys(SHOWN_AT).sort()).toEqual(Object.keys(formFrom()).sort())
  })

  it.each(Object.entries(SHOWN_AT))('shows %s', (_field, [file, line]) => {
    expect(FILES[file]).toMatch(line)
  })

  it('draws the date the deadline chip carries in the header', () => {
    expect(header).toContain('i18nKey="header.deadlineChip"')
    expect(header).toContain('date: domain.shortDate(deadline.date)')
    expect(en.header.deadlineChip).toContain('Deadline {{date}}')
  })
})
