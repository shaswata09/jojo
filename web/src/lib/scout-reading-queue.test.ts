/**
 * The scout's background reader, decided without a tree: which card it opens,
 * what a Discard may take back out, and the lock and hand-off between a read
 * and an approval. The findings held here are R6 and R9 of the 2026-11 review.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Proposal } from '@jojo/service/core/model'
import type { ScoutReading } from '@jojo/service/core/proposal'
import {
  autoReadable,
  discardablePages,
  nextToRead,
  otherClaimant,
  readingQueue,
  scoutKeptFor,
  scoutKeptNote,
} from './scout-reading-queue'

afterEach(() => readingQueue.reset())

const card = (id: string, url: string, over: Partial<Proposal> = {}): Proposal => ({
  id,
  pipelineId: 'pl_1',
  kind: 'scout',
  tool: 'scout.posting.save',
  input: JSON.stringify({ url, title: 'Lecturer' }),
  title: 'Save Lecturer',
  rationale: '',
  status: 'pending',
  proposedAt: '2026-11-13T00:00:00.000Z' as Proposal['proposedAt'],
  ...over,
})

const cra = { id: 'pl_1', source: 'https://cra.org/ads/', enabled: true }
const nothingListed = () => false

describe('what the reader opens on its own', () => {
  it('opens an address on a board the pipeline watches', () => {
    expect(
      autoReadable('https://careercenter.cra.org/job/lecturer/71012/', cra, nothingListed),
    ).toBe(true)
  })

  it('leaves a model-written address on another site for Approve (R6)', () => {
    expect(autoReadable('https://mail.google.com/mail/u/0/', cra, nothingListed)).toBe(false)
    expect(autoReadable('https://evil.example/collect?x=1', cra, nothingListed)).toBe(false)
    // Shaped like a posting, and still not on a board this pipeline watches.
    expect(autoReadable('https://evil.example/jobs/40112', cra, nothingListed)).toBe(false)
  })

  it('opens an off-board address a board read listed', () => {
    const listed = (pipelineId: string, url: string) =>
      pipelineId === 'pl_1' && url === 'https://jobs.ksu.edu/jobs/40112'
    expect(autoReadable('https://jobs.ksu.edu/jobs/40112', cra, listed)).toBe(true)
  })

  /*
   * Round 3: the board's host alone let in every signed-in page on it. With
   * LinkedIn watched, the inbox and the account settings were opened, read and
   * sent to the model.
   */
  it('opens only a posting on a watched board, never another page there', () => {
    // Round 3 was found with LinkedIn watched; LinkedIn is now never opened
    // unattended at all (below), so the same rule is held on a board that
    // still can be: a signed-in applicant-tracking site.
    const greenhouse = { id: 'pl_1', source: 'https://job-boards.greenhouse.io/acme' }
    for (const page of [
      'https://job-boards.greenhouse.io/acme',
      'https://my.greenhouse.io/users/sign_in',
      'https://my.greenhouse.io/profile/settings',
      'https://careercenter.cra.org/account/',
    ]) {
      expect(autoReadable(page, page.includes('cra') ? cra : greenhouse, nothingListed), page).toBe(
        false,
      )
    }
    expect(
      autoReadable('https://job-boards.greenhouse.io/acme/jobs/4012345', greenhouse, nothingListed),
    ).toBe(true)
  })

  /*
   * LinkedIn, Indeed, Glassdoor and ZipRecruiter forbid automated access in
   * their terms. A card for a posting there waits for the person's own
   * Approve — even on a pipeline that watches the site, even when a board read
   * listed it, and even when the address written is somewhere else that
   * opens as one of theirs.
   */
  it('never opens a posting on a site whose terms forbid robots', () => {
    const everything = () => true
    const linkedin = { id: 'pl_1', source: 'https://www.linkedin.com/jobs/' }
    expect(
      autoReadable('https://www.linkedin.com/jobs/view/4012345/', linkedin, nothingListed),
    ).toBe(false)
    expect(autoReadable('https://www.linkedin.com/jobs/view/4012345/', cra, everything)).toBe(false)
    expect(
      autoReadable('https://www.linkedin.com/messaging/?currentJobId=4012345', linkedin, everything),
    ).toBe(false)
    expect(
      autoReadable('https://www.indeed.com/viewjob?jk=abc123', { id: 'pl_1', source: 'indeed.com' }, everything),
    ).toBe(false)
  })

  it('judges the address that will be opened, not only the one written', () => {
    // Greenhouse's embed spelling is not a posting's shape as written, and is
    // opened as the posting it names.
    const greenhouse = { id: 'pl_1', source: 'https://job-boards.greenhouse.io/acme' }
    expect(
      autoReadable(
        'https://boards.greenhouse.io/embed/job_app?for=acme&token=4012345',
        greenhouse,
        nothingListed,
      ),
    ).toBe(true)
  })

  it('opens no listed address that is not a posting', () => {
    const everything = () => true
    expect(autoReadable('https://mail.google.com/mail/u/0/', cra, everything)).toBe(false)
  })

  it('never opens this machine or the person’s network, listed or not', () => {
    const everything = () => true
    expect(autoReadable('http://192.168.1.1/admin', cra, everything)).toBe(false)
    expect(
      autoReadable('http://localhost:3000/', { ...cra, source: 'localhost' }, everything),
    ).toBe(false)
  })
})

describe('the next card to read', () => {
  it('skips a card whose pipeline is paused or gone', () => {
    const one = card('p1', 'https://cra.org/ads/jobs/4401')
    expect(nextToRead([one], [{ ...cra, enabled: false }], new Set(), nothingListed)).toBeNull()
    expect(nextToRead([one], [], new Set(), nothingListed)).toBeNull()
    expect(nextToRead([one], [cra], new Set(), nothingListed)?.proposal.id).toBe('p1')
  })

  it('skips a card it may not open and takes the next one it may', () => {
    const off = card('p1', 'https://mail.google.com/')
    const on = card('p2', 'https://cra.org/ads/jobs/4402')
    expect(nextToRead([off, on], [cra], new Set(), nothingListed)).toMatchObject({
      proposal: { id: 'p2' },
      url: 'https://cra.org/ads/jobs/4402',
      pipelineId: 'pl_1',
    })
  })

  it('skips a card already tried, answered, read, or being read', () => {
    const tried = card('p1', 'https://cra.org/ads/jobs/4401')
    const answered = card('p2', 'https://cra.org/ads/jobs/4402', { status: 'approved' })
    const read = card('p3', 'https://cra.org/ads/jobs/4403', {
      reading: '{"ok":false,"reason":"x"}',
    })
    const running = card('p4', 'https://cra.org/ads/jobs/4404')
    readingQueue.start('p4', new Promise(() => {}))
    expect(
      nextToRead([tried, answered, read, running], [cra], new Set(['p1']), nothingListed),
    ).toBeNull()
  })
})

describe('what a Discard may take out of the Vault (R9)', () => {
  const base = { ok: true, fields: {}, keywords: [], missing: [], via: 'extension', readAt: '' }
  const noFiles: { id: string; note?: string }[] = []

  it('a page the card’s own read created', () => {
    const reading = { ...base, fileId: 'f1', created: true } as ScoutReading
    expect(discardablePages('p1', reading, noFiles)).toEqual(['f1'])
  })

  it('never a page the read reused — it may be the person’s own clip', () => {
    expect(discardablePages('p1', { ...base, fileId: 'f1' } as ScoutReading, noFiles)).toEqual([])
    expect(discardablePages('p1', null, noFiles)).toEqual([])
  })

  it('a page a finished read passed in after the card was answered', () => {
    expect(discardablePages('p1', null, noFiles, 'f2')).toEqual(['f2'])
  })

  /*
   * Round 3: a reload between keeping the page and the model's answer lost the
   * reading that said "created". The next pass reused the page, its reading
   * said "not created", and Discard left it in the Vault for good.
   */
  it('a page marked as kept for this card, though its reading says reused', () => {
    const files = [
      { id: 'f1', note: scoutKeptNote('Captured from careercenter.cra.org', 'prp:1') },
      { id: 'f2', note: scoutKeptNote(undefined, 'prp:2') },
    ]
    const reused = { ...base, fileId: 'f1' } as ScoutReading
    expect(discardablePages('prp:1', reused, files)).toEqual(['f1'])
    // Marked, with no reading on the card at all: the discard came first.
    expect(discardablePages('prp:2', null, files)).toEqual(['f2'])
    // Another card's page is never this one's.
    expect(discardablePages('prp:3', null, files)).toEqual([])
  })

  it('never a page kept before the marker existed, or one whose note the person rewrote', () => {
    const files = [
      { id: 'f1', note: 'Captured from careercenter.cra.org' },
      { id: 'f2' },
      { id: 'f3', note: 'Kept while reading a scout suggestion (prp:1) — I want this one' },
    ]
    expect(discardablePages('prp:1', { ...base, fileId: 'f1' } as ScoutReading, files)).toEqual([])
  })
})

describe('the note that says which suggestion kept a page', () => {
  it('is added to what the note already said, and read back', () => {
    const note = scoutKeptNote('Captured from cra.org · 2 assets could not be kept', 'prp:01-ab')
    expect(note).toBe(
      'Captured from cra.org · 2 assets could not be kept · Kept while reading a scout suggestion (prp:01-ab)',
    )
    expect(scoutKeptFor(note)).toBe('prp:01-ab')
    expect(scoutKeptFor(scoutKeptNote(undefined, 'prp:2'))).toBe('prp:2')
  })

  it('names one suggestion, however often it is written', () => {
    const twice = scoutKeptNote(scoutKeptNote('Read by the model', 'prp:1'), 'prp:2')
    expect(twice).toBe('Read by the model · Kept while reading a scout suggestion (prp:2)')
    expect(scoutKeptFor(twice)).toBe('prp:2')
  })

  it('reads nothing into a note without one', () => {
    expect(scoutKeptFor(undefined)).toBeUndefined()
    expect(scoutKeptFor('')).toBeUndefined()
    expect(scoutKeptFor('Captured from cra.org')).toBeUndefined()
  })
})

describe('another card that still points at a page', () => {
  const withPage = (id: string, status: Proposal['status'], fileId: string) => ({
    id,
    status,
    reading: JSON.stringify({
      ok: true,
      fields: {},
      keywords: [],
      missing: [],
      via: 'extension',
      readAt: '',
      fileId,
    }),
  })

  it('is a claim while that card is pending or approved, and not once it is discarded', () => {
    expect(otherClaimant([withPage('p2', 'pending', 'f1')], 'p1', 'f1')).toBe(true)
    expect(otherClaimant([withPage('p2', 'approved', 'f1')], 'p1', 'f1')).toBe(true)
    expect(otherClaimant([withPage('p2', 'discarded', 'f1')], 'p1', 'f1')).toBe(false)
  })

  it('is never the card being discarded, nor a card pointing elsewhere', () => {
    expect(otherClaimant([withPage('p1', 'pending', 'f1')], 'p1', 'f1')).toBe(false)
    expect(otherClaimant([withPage('p2', 'pending', 'f9')], 'p1', 'f1')).toBe(false)
    expect(otherClaimant([{ id: 'p2', status: 'pending' }], 'p1', 'f1')).toBe(false)
  })
})

describe('the lock and the hand-off', () => {
  const reading: ScoutReading = { ok: false, reason: 'Sign in first.', readAt: '' }

  it('is busy while any read runs, and not after', async () => {
    let finish: (r: ScoutReading) => void = () => {}
    readingQueue.start('p1', new Promise((resolve) => (finish = resolve)))
    expect(readingQueue.busy()).toBe(true)
    expect(readingQueue.reading('p1')).toBe(true)
    finish(reading)
    await readingQueue.take('p1')
    expect(readingQueue.busy()).toBe(false)
  })

  it('keeps a reading that finished before its approval came, until it is taken', async () => {
    readingQueue.start('p1', Promise.resolve(reading))
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readingQueue.busy()).toBe(false)
    expect(await readingQueue.take('p1')).toEqual(reading)
    // Taken once: the approval reads the page once.
    expect(readingQueue.take('p1')).toBeUndefined()
  })

  it('lets a finished reading go once its card has left the queue', async () => {
    readingQueue.start('p1', Promise.resolve(reading))
    readingQueue.start('p2', Promise.resolve(reading))
    await new Promise((resolve) => setTimeout(resolve, 0))
    readingQueue.settle((id) => id === 'p2')
    expect(readingQueue.take('p1')).toBeUndefined()
    expect(await readingQueue.take('p2')).toEqual(reading)
  })

  it('keeps nothing for a read that was stopped', async () => {
    readingQueue.start('p1', Promise.resolve(null))
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(readingQueue.take('p1')).toBeUndefined()
  })
})
