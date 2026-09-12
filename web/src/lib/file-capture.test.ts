/**
 * Which application a captured page is filed under.
 *
 * Reported 2026-09-12: one saved posting was attached to two different
 * applications. The match was origin plus path, and on a board that keys its
 * jobs by query — HigherEdJobs's `/faculty/details.cfm?JobCode=…`, Indeed's
 * `/viewjob?jk=` — every posting on the site shared an address, so a page went
 * to whichever job was first in the list and the fit panel then scored that
 * application against somebody else's requirements.
 *
 * The hook around this cannot be mounted (D20), and does not need to be: the
 * decision is a pure function, and this is it.
 */
import { describe, expect, it } from 'vitest'
import { applicationForCapture, captureFileRecord } from './file-capture'

const HEJ = 'https://www.higheredjobs.com/faculty/details.cfm?JobCode='

const applications = [
  { id: 'ut', url: `${HEJ}179545452&Title=Assistant%20Professor` },
  { id: 'msu', url: `${HEJ}188000001&Title=Lecturer` },
  { id: 'stripe', url: 'https://stripe.com/jobs/search?gh_jid=8172508' },
  { id: 'typed', url: undefined },
]

describe('the application a capture belongs to', () => {
  it('files each posting under its own job, not the first on the board', () => {
    expect(
      applicationForCapture(applications, `${HEJ}179545452&Title=Assistant%20Professor`)?.id,
    ).toBe('ut')
    expect(applicationForCapture(applications, `${HEJ}188000001&Title=Lecturer`)?.id).toBe('msu')
  })

  it('still recognises the posting under the tracking a copied link carries', () => {
    expect(
      applicationForCapture(
        applications,
        `${HEJ}179545452&Title=Assistant%20Professor&utm_source=alert&gh_src=x`,
      )?.id,
    ).toBe('ut')
  })

  it('attaches nothing when the page is a job nobody is tracking', () => {
    expect(applicationForCapture(applications, `${HEJ}999999999&Title=Dean`)).toBeNull()
    expect(
      applicationForCapture(applications, 'https://stripe.com/jobs/search?gh_jid=9999999'),
    ).toBeNull()
  })

  it('never matches an application that has no address, or a page with none', () => {
    // `undefined === undefined` would file every capture under every hand-typed
    // application; an unusable address must match nothing rather than anything.
    expect(applicationForCapture(applications, 'not a url')).toBeNull()
    expect(
      applicationForCapture([{ id: 'typed', url: undefined }], 'https://boards.test/j/1'),
    ).toBeNull()
  })
})

describe('the record a saved capture becomes', () => {
  const capture = {
    url: 'https://boards.example.com/jobs/4711',
    title: 'Senior ML Engineer',
    html: '<!doctype html><p>posting</p>',
    capturedAt: '2026-09-12T09:00:00.000Z',
    dropped: 0,
    shadowRoots: 0,
  }

  it('is filed under NO application, however well the address matches one', () => {
    /*
     * The rule, and it is an absence, which is why it is pinned here.
     *
     * A capture used to file itself under the application whose posting URL it
     * matched. Keeping a page and filing it are two acts and both are the
     * user's: a page kept from a listing is not always about the application
     * already tracking that listing, and a record that joins itself to another
     * is a link nobody chose and nobody watched being made. `applicationIds` is
     * set by the Vault's picker on the file's own row, and nowhere else.
     */
    const record = captureFileRecord(capture, '2026-09-12', 4096)
    expect('applicationIds' in record).toBe(false)
    expect(Object.keys(record)).not.toContain('applicationIds')
  })

  it('goes in the postings drawer rather than among the documents you wrote', () => {
    expect(captureFileRecord(capture, '2026-09-12', 4096).bucket).toBe('Job postings')
  })

  it('keeps the address it came from, which is what a later match would use', () => {
    const record = captureFileRecord(capture, '2026-09-12', 4096)
    expect(record.sourceUrl).toBe(capture.url)
    expect(record.capturedAt).toBe(capture.capturedAt)
    expect(record.kind).toBe('page')
  })
})
