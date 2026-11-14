import { describe, expect, it } from 'vitest'
import {
  alreadyHaveDescription,
  approveAllToast,
  approvedDescription,
  fillDoneToast,
  fillFailedToast,
  identityOf,
  withScheme,
} from './scout-approval'

const done = (over: Partial<Parameters<typeof fillDoneToast>[0]> = {}) => ({
  ok: true as const,
  application: 'a1',
  name: 'Kansas State University — Assistant Professor',
  filled: [] as string[],
  confirmed: [] as string[],
  keptYours: [] as string[],
  missing: [] as string[],
  via: 'reader' as const,
  ...over,
})

describe('identityOf', () => {
  it('reads the listing when the page was not read', () => {
    const input = JSON.stringify({
      org: 'CRA',
      title: 'Assistant professor',
      location: 'Manhattan, KS',
      url: 'https://cra.org/job/1',
    })
    expect(identityOf(input)).toEqual({
      org: 'CRA',
      role: 'Assistant professor',
      location: 'Manhattan, KS',
      url: 'https://cra.org/job/1',
      postingId: undefined,
    })
  })

  it('prefers what the page said over what the listing said', () => {
    const input = JSON.stringify({ org: 'CRA', title: 'Assistant professor', url: 'u' })
    const reading = JSON.stringify({
      ok: true,
      fields: { org: 'Kansas State University', role: 'Assistant Professor', postingId: 'R123' },
      keywords: [],
      missing: [],
      via: 'reader',
      readAt: '2026-10-27',
    })
    expect(identityOf(input, reading)).toMatchObject({
      org: 'Kansas State University',
      role: 'Assistant Professor',
      url: 'u',
      postingId: 'R123',
    })
  })

  it('ignores a failed reading and non-string fields', () => {
    const input = JSON.stringify({ org: 7, title: 'Role' })
    const reading = JSON.stringify({ ok: false, reason: 'blocked', readAt: '' })
    expect(identityOf(input, reading)).toMatchObject({ org: undefined, role: 'Role' })
  })

  it('is empty when the input does not parse, or is null', () => {
    expect(identityOf('{not json')).toEqual({})
    expect(identityOf('null')).toEqual({})
  })
})

describe('withScheme', () => {
  it('adds https to a bare address and trims', () => {
    expect(withScheme(' jobs.rice.edu/123 ')).toBe('https://jobs.rice.edu/123')
  })
  it('keeps an address that has a scheme', () => {
    expect(withScheme('http://a.b/c')).toBe('http://a.b/c')
    expect(withScheme('HTTPS://a.b')).toBe('HTTPS://a.b')
  })
})

describe('alreadyHaveDescription', () => {
  it('names the role when there is one', () => {
    expect(alreadyHaveDescription({ org: 'Rice', role: 'Lecturer' })).toMatch(
      /^This is Rice — Lecturer, reposted/,
    )
    expect(alreadyHaveDescription({ org: 'Rice', role: '' })).toMatch(/^This is Rice, reposted/)
  })
})

describe('fill toasts', () => {
  it('says what was filled, checked, kept and missing', () => {
    const t = fillDoneToast(
      done({
        filled: ['org', 'role'],
        confirmed: ['deadline'],
        keptYours: ['notes'],
        missing: ['pay'],
      }),
    )
    expect(t.title).toBe('Kansas State University — Assistant Professor filled from the posting')
    expect(t.description).toBe(
      'Filled in: org, role. Checked against the page: deadline. Kept your edits to: notes. Not on the page: pay. The page is filed under it.',
    )
  })

  it('says the page added nothing when nothing was filled or confirmed', () => {
    const t = fillDoneToast(done())
    expect(t.title).toBe(
      'Kansas State University — Assistant Professor checked against the posting',
    )
    expect(t.description).toBe(
      'The page added nothing the draft did not have. The page is filed under it.',
    )
  })

  it('says whether the page was kept when the read failed', () => {
    const failed = { ok: false as const, step: 'reading' as const, reason: 'Sign-in wall.' }
    expect(fillFailedToast('Rice', failed).title).toBe('Rice: the posting could not be read')
    expect(fillFailedToast('Rice', failed).description).toMatch(/draft keeps what its link says/)
    expect(fillFailedToast('Rice', { ...failed, kept: true }).description).toMatch(
      /page itself was saved/,
    )
  })
})

describe('approval toasts', () => {
  it('describes one approval by page and model', () => {
    expect(approvedDescription(false, true)).toBe('Open it to fill in the rest.')
    expect(approvedDescription(true, true)).toMatch(/^Reading the posting/)
    expect(approvedDescription(true, false)).toMatch(/^Filled from its link/)
  })

  it('says nothing when Approve all made nothing', () => {
    expect(approveAllToast(0, 0, true)).toBeNull()
  })

  it('says only repeats when every job was already there', () => {
    expect(approveAllToast(0, 1, true)?.description).toMatch(
      /^1 is a job .* It is linked to the application you have\.$/,
    )
    expect(approveAllToast(0, 2, true)?.description).toMatch(
      /^2 are jobs .* They are linked to the applications you have\.$/,
    )
  })

  it('counts drafts and repeats', () => {
    expect(approveAllToast(3, 0, true)?.title).toBe('3 added to your applications as drafts')
    expect(approveAllToast(3, 2, false)).toEqual({
      title: '3 added to your applications as drafts · 2 already there',
      description:
        'Filled from their links. Connect a model in Settings to have the postings themselves read in.',
    })
  })
})
