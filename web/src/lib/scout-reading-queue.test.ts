/**
 * The scout's background reader, decided without a tree: which card it opens,
 * what a Discard may take back out, and the lock and hand-off between a read
 * and an approval. The findings held here are R6 and R9 of the 2026-11 review.
 */

import { afterEach, describe, expect, it } from 'vitest'
import type { Proposal } from '@jojo/service/core/model'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { autoReadable, discardablePage, nextToRead, readingQueue } from './scout-reading-queue'

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
    expect(autoReadable('https://careercenter.cra.org/job/1', cra, nothingListed)).toBe(true)
  })

  it('leaves a model-written address on another site for Approve (R6)', () => {
    expect(autoReadable('https://mail.google.com/mail/u/0/', cra, nothingListed)).toBe(false)
    expect(autoReadable('https://evil.example/collect?x=1', cra, nothingListed)).toBe(false)
  })

  it('opens an off-board address a board read listed', () => {
    const listed = (pipelineId: string, url: string) =>
      pipelineId === 'pl_1' && url === 'https://jobs.ksu.edu/1'
    expect(autoReadable('https://jobs.ksu.edu/1', cra, listed)).toBe(true)
  })

  it('never opens this machine or the person’s network, listed or not', () => {
    const everything = () => true
    expect(autoReadable('http://192.168.1.1/admin', cra, everything)).toBe(false)
    expect(autoReadable('http://localhost:3000/', { ...cra, source: 'localhost' }, everything)).toBe(
      false,
    )
  })
})

describe('the next card to read', () => {
  it('skips a card whose pipeline is paused or gone', () => {
    const one = card('p1', 'https://cra.org/ads/1')
    expect(nextToRead([one], [{ ...cra, enabled: false }], new Set(), nothingListed)).toBeNull()
    expect(nextToRead([one], [], new Set(), nothingListed)).toBeNull()
    expect(nextToRead([one], [cra], new Set(), nothingListed)?.proposal.id).toBe('p1')
  })

  it('skips a card it may not open and takes the next one it may', () => {
    const off = card('p1', 'https://mail.google.com/')
    const on = card('p2', 'https://cra.org/ads/2')
    expect(nextToRead([off, on], [cra], new Set(), nothingListed)).toMatchObject({
      proposal: { id: 'p2' },
      url: 'https://cra.org/ads/2',
      pipelineId: 'pl_1',
    })
  })

  it('skips a card already tried, answered, read, or being read', () => {
    const tried = card('p1', 'https://cra.org/ads/1')
    const answered = card('p2', 'https://cra.org/ads/2', { status: 'approved' })
    const read = card('p3', 'https://cra.org/ads/3', { reading: '{"ok":false,"reason":"x"}' })
    const running = card('p4', 'https://cra.org/ads/4')
    readingQueue.start('p4', new Promise(() => {}))
    expect(
      nextToRead([tried, answered, read, running], [cra], new Set(['p1']), nothingListed),
    ).toBeNull()
  })
})

describe('what a Discard may take out of the Vault (R9)', () => {
  const base = { ok: true, fields: {}, keywords: [], missing: [], via: 'extension', readAt: '' }

  it('a page the card’s own read created', () => {
    const reading = { ...base, fileId: 'f1', created: true } as ScoutReading
    expect(discardablePage(reading)).toBe('f1')
  })

  it('never a page the read reused — it may be the person’s own clip', () => {
    expect(discardablePage({ ...base, fileId: 'f1' } as ScoutReading)).toBeNull()
    expect(discardablePage(null)).toBeNull()
  })

  it('a page a finished read passed in after the card was answered', () => {
    expect(discardablePage(null, 'f2')).toBe('f2')
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
