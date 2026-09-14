/**
 * The two mappings that decide which fields of an application reach the store.
 *
 * `add()` takes an `ApplicationDraft` and `application.create` takes a schema;
 * `update()` takes a `Partial<Application>` and `application.update` takes
 * another. Between each pair sits a function that names every field by hand,
 * and a field that is not named there is dropped without a word — the write
 * still returns `ok`. `postingId` went that way: the form had it, the writer
 * trimmed it, the tool's schema accepted it, and the store never saw it, so
 * the duplicate check's "same posting ID" rule had nothing on the far side to
 * match (measured 2026-09-12: the model caught the duplicate the ID should
 * have). `use-profile.ts` lost `roles` the same way a release earlier.
 *
 * So both tests below hold the mapping's output keys against a value the
 * compiler forces to be complete — `Required<…>` of the record type. Add a
 * field to `Application` and each of these fails until the mapping names it,
 * which is the only way a mapping written out by hand stays honest.
 *
 * No component is mounted (D20); this is why both mappings are module-level
 * functions rather than bodies inside the `useCallback`s.
 */

import { describe, expect, it } from 'vitest'
import type { Application } from '../core/model'
import type { ApplicationDraft } from './use-applications'
import { applicationCreateInput, applicationUpdateInput } from './use-applications'

const TODAY = '2026-09-12'

/**
 * Every field a draft can carry, each with a value distinguishable from the
 * others, so a mapping that forwarded the WRONG field is caught as well as one
 * that forwarded no field. `Required<>` is what makes the compiler refuse an
 * incomplete sample.
 */
const FULL_DRAFT: Required<ApplicationDraft> = {
  org: 'Rice University',
  role: 'Assistant Professor, Statistics',
  roleTag: 'Assistant Professor',
  stage: 'submitted',
  note: 'Deadline is soft.',
  flagged: true,
  lastAction: 'Submitted the packet',
  daysAgo: 3,
  source: 'Job board',
  location: 'Houston, TX',
  comp: '$120k',
  url: 'https://jobs.rice.edu/postings/4012',
  postingId: 'JobCode 179545452',
  appliedOn: '2026-09-01',
  submittedOn: '2026-09-02',
  firstReplyOn: '2026-09-05',
  outcome: 'rejected',
  offer: { respondBy: '2026-10-01', comp: '$120k base', note: 'Verbal so far.' },
}

/**
 * The same record as the store would read it back.
 *
 * `stageDates` is here and not in the draft above: a record being created has
 * no history, and the dates are stamped as it moves. `update` still has to
 * carry them, because correcting one is an update.
 */
const FULL_APP: Required<Application> = {
  ...FULL_DRAFT,
  id: 'app:0192-rice',
  slug: 'rice',
  stageDates: { screen: '2026-09-14', interview: '2026-09-20' },
}

/**
 * What `add()` does NOT forward, and why:
 *  - `daysAgo` is derived from `lastActionAt`, which `application.create`
 *    stamps as `ctx.now`; a count of days on a draft is not a write.
 */
const NOT_ON_CREATE = ['daysAgo']

/**
 * What `update()` does NOT forward under its own name, and why:
 *  - `slug` is minted once from the employer name and never rewritten.
 *  - `daysAgo` is derived, but a restore hands one back — it goes through as
 *    `lastActionAt`, checked separately below.
 */
const NOT_ON_UPDATE = ['slug', 'daysAgo']

describe('applicationCreateInput', () => {
  it('forwards EVERY field of a draft, not the ones somebody remembered', () => {
    const input = applicationCreateInput(FULL_DRAFT)
    const expected = Object.keys(FULL_DRAFT).filter((k) => !NOT_ON_CREATE.includes(k))
    // Sorted set comparison, so the failure message names the missing field.
    expect(Object.keys(input).sort()).toEqual(expected.sort())
    for (const key of expected) {
      expect((input as Record<string, unknown>)[key], key).toEqual(
        (FULL_DRAFT as Record<string, unknown>)[key],
      )
    }
  })

  it('carries the posting ID, the field the duplicate check compares first', () => {
    expect(applicationCreateInput(FULL_DRAFT).postingId).toBe('JobCode 179545452')
  })

  it('leaves an absent optional field absent rather than writing undefined', () => {
    const { postingId: _p, url: _u, offer: _o, ...without } = FULL_DRAFT
    const input = applicationCreateInput(without)
    expect(Object.hasOwn(input, 'postingId')).toBe(false)
    expect(Object.hasOwn(input, 'url')).toBe(false)
    expect(Object.hasOwn(input, 'offer')).toBe(false)
  })
})

describe('applicationUpdateInput', () => {
  it('forwards EVERY field of a full patch, plus the id', () => {
    const input = applicationUpdateInput(FULL_APP.id, FULL_APP, TODAY)
    const expected = Object.keys(FULL_APP)
      .filter((k) => !NOT_ON_UPDATE.includes(k))
      .concat('lastActionAt')
    expect(Object.keys(input).sort()).toEqual([...new Set(expected)].sort())
    for (const key of expected) {
      if (key === 'lastActionAt') continue
      expect((input as Record<string, unknown>)[key], key).toEqual(
        (FULL_APP as Record<string, unknown>)[key],
      )
    }
  })

  it('turns a restored daysAgo into the instant it describes', () => {
    const input = applicationUpdateInput('x', { daysAgo: 3 }, TODAY)
    expect(input.lastActionAt).toBe(new Date(Date.parse('2026-09-09T12:00:00')).toISOString())
    expect(Object.hasOwn(input, 'daysAgo')).toBe(false)
  })

  it('clears a text field that is present and blank, and leaves an absent one alone', () => {
    // Present-and-undefined is how a form hands back an emptied input: it
    // becomes '' so the tool's `cleared()` deletes the key. The cast is because
    // `exactOptionalPropertyTypes` refuses the spelling at compile time while
    // the writers still produce it at run time — which is the case `asText`
    // exists for.
    const emptied = { postingId: undefined } as unknown as Partial<Application>
    expect(applicationUpdateInput('x', emptied, TODAY)).toEqual({ id: 'x', postingId: '' })
    expect(applicationUpdateInput('x', { url: '' }, TODAY)).toEqual({ id: 'x', url: '' })
    // Absent means "leave it alone" — no key at all.
    expect(applicationUpdateInput('x', { org: 'Rice' }, TODAY)).toEqual({ id: 'x', org: 'Rice' })
  })
})
