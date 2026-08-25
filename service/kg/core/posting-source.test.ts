/**
 * Finding the page an application was measured against.
 *
 * The tests below are mostly about NOT finding one. A fit score computed
 * against the wrong document looks exactly like a fit score computed against
 * the right one, so the failure this file has to avoid is a confident match on
 * a page that has nothing to do with the job — a board's search results, or the
 * listing next to it on the same board.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from './snapshot'
import type { StoredNode } from './model'
import type { GraphSnapshot } from './snapshot'
import { HOW_LABEL, postingSourceFor, postingSourceForUrl } from './posting-source'

const AT = '2026-09-14T09:00:00.000Z'

const node = (id: string, type: string, props: Record<string, unknown>) =>
  ({ id, type, props, createdAt: AT, updatedAt: AT }) as unknown as StoredNode

function graph(nodes: StoredNode[], edges: { from: string; rel: string; to: string }[] = []) {
  const m = new MutableSnapshot()
  m.reset(
    nodes,
    edges.map((e) => ({
      id: `${e.from}|${e.rel}|${e.to}`,
      rel: e.rel,
      from: e.from,
      to: e.to,
      props: {},
      createdAt: AT,
    })) as never,
  )
  return m as unknown as GraphSnapshot
}

const app = (id: string, url?: string) =>
  node(id, 'application', {
    slug: id,
    role: 'Staff Engineer',
    note: '',
    roleTag: 'Industry',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: AT,
    ...(url === undefined ? {} : { url }),
  })

const capture = (id: string, name: string, sourceUrl?: string, bucket = 'Job postings') =>
  node(id, 'file', {
    slug: id,
    name,
    kind: 'page',
    bucket,
    size: '40 KB',
    savedOn: '2026-09-01',
    ...(sourceUrl === undefined ? {} : { sourceUrl }),
  })

const written = (id: string, name: string) =>
  node(id, 'file', {
    slug: id,
    name,
    kind: 'pdf',
    bucket: 'Applications',
    size: '400 KB',
    savedOn: '2026-09-01',
  })

describe('when there is nothing behind the application', () => {
  it('returns null for one somebody typed in', () => {
    /*
     * The answer the whole file exists to be able to give. A hand-typed
     * application has no posting, and the alternative — building requirements
     * out of its role title — would produce a fit score indistinguishable from
     * a real one.
     */
    expect(postingSourceFor(graph([app('a1')]), 'a1')).toBeNull()
  })

  it('returns null rather than reaching for the CV', () => {
    // Every file in the Vault is a candidate for the URL match, and the one
    // thing that must never be assessed as a posting is the person's own
    // document — the requirements would come out as their qualifications.
    const g = graph([app('a1'), written('f1', 'CV-2026.pdf')])
    expect(postingSourceFor(g, 'a1')).toBeNull()
  })

  it('returns null for an application that does not exist', () => {
    expect(postingSourceFor(graph([]), 'a1')).toBeNull()
  })
})

describe('what the user attached themselves', () => {
  it('wins over everything else', () => {
    const g = graph(
      [
        app('a1', 'https://boards.example.com/jobs/1'),
        capture('f1', 'listing-1.html', 'https://boards.example.com/jobs/1'),
        capture('f2', 'the-one-they-meant.html', 'https://elsewhere.example/jobs/9'),
      ],
      [{ from: 'f2', rel: 'FILED_UNDER', to: 'a1' }],
    )
    const found = postingSourceFor(g, 'a1')
    expect(found?.fileId).toBe('f2')
    expect(found?.how).toBe('filed-under')
  })

  it('takes the newest when two are attached', () => {
    // Attaching a second capture is a correction, not a second opinion. Ids are
    // uuidv7 so id order is creation order, and the snapshot returns them so.
    const g = graph(
      [app('a1'), capture('f1', 'old.html'), capture('f2', 'reposted.html')],
      [
        { from: 'f1', rel: 'FILED_UNDER', to: 'a1' },
        { from: 'f2', rel: 'FILED_UNDER', to: 'a1' },
      ],
    )
    expect(postingSourceFor(g, 'a1')?.fileId).toBe('f2')
  })

  it('ignores an attached document the user wrote', () => {
    // A cover letter filed under the job is the commonest attachment there is,
    // and assessing the application against it would score the person's own
    // prose as the employer's requirements.
    const g = graph(
      [app('a1'), written('f1', 'cover-letter.pdf')],
      [{ from: 'f1', rel: 'FILED_UNDER', to: 'a1' }],
    )
    expect(postingSourceFor(g, 'a1')).toBeNull()
  })
})

describe('matching on the address', () => {
  it('joins the importer’s capture to the application it filled in', () => {
    /*
     * Neither record points at the other: `AddFromLinkDialog` saves the page
     * with `sourceUrl` and opens the form with `url`, and nothing links them.
     * This is what stands in for that link.
     */
    const g = graph([
      app('a1', 'https://boards.example.com/jobs/1'),
      capture('f1', 'listing.html', 'https://boards.example.com/jobs/1'),
    ])
    const found = postingSourceFor(g, 'a1')
    expect(found?.fileId).toBe('f1')
    expect(found?.how).toBe('same-url')
    expect(found?.url).toBe('https://boards.example.com/jobs/1')
  })

  it('forgives a trailing slash, a fragment and a capitalised host', () => {
    const g = graph([
      app('a1', 'https://Boards.Example.com/jobs/1/#apply'),
      capture('f1', 'listing.html', 'https://boards.example.com/jobs/1'),
    ])
    expect(postingSourceFor(g, 'a1')?.fileId).toBe('f1')
  })

  it('keeps the query, because that is where the listing id lives', () => {
    /*
     * The failure that would otherwise be invisible. Greenhouse and Lever put
     * the job id in the query, so dropping it makes every listing on a board
     * the same page — and hands an application whichever posting was captured
     * first, scored confidently against the wrong requirements.
     */
    const g = graph([
      app('a1', 'https://boards.example.com/jobs?gh_jid=4012'),
      capture('f1', 'other-job.html', 'https://boards.example.com/jobs?gh_jid=9999'),
    ])
    expect(postingSourceFor(g, 'a1')).toBeNull()
  })

  it('does not match two records that both have no address', () => {
    // `undefined === undefined` is the bug this guards: without the null check
    // every hand-typed application would match every uncaptured page.
    const g = graph([app('a1'), capture('f1', 'a page.html')])
    expect(postingSourceFor(g, 'a1')).toBeNull()
  })

  it('does not fall over on something that is not a URL', () => {
    // Both fields are free text somebody can type into.
    const g = graph([app('a1', 'the careers page'), capture('f1', 'x.html', 'also not a url')])
    expect(postingSourceFor(g, 'a1')).toBeNull()
  })
})

describe('following the scout', () => {
  it('reaches the capture through the posting that became the application', () => {
    const g = graph(
      [
        app('a1'),
        node('p1', 'posting', {
          slug: 'p1',
          title: 'Staff Engineer',
          url: 'https://boards.example.com/jobs/1',
          savedOn: '2026-09-01',
          size: '40 KB',
        }),
        capture('f1', 'listing.html', 'https://boards.example.com/jobs/1'),
      ],
      [{ from: 'p1', rel: 'BECAME', to: 'a1' }],
    )
    const found = postingSourceFor(g, 'a1')
    expect(found?.fileId).toBe('f1')
    expect(found?.how).toBe('via-posting')
  })
})

describe('saying how it was found', () => {
  it('has a phrase for every way', () => {
    // Rendered next to the score, so somebody can tell whether jojo measured
    // them against the listing or against the board's search page.
    for (const label of Object.values(HOW_LABEL)) expect(label.length).toBeGreaterThan(0)
  })
})

describe('asking before the application exists', () => {
  it('finds the posting from the address the form was filled from', () => {
    /*
     * The create form's half. A snapshot taken before the write does not hold
     * the new application, so this answers the same question from the one field
     * the form has — which is what lets the requirements be read while the
     * person carries on, instead of when they next open the record.
     */
    const g = graph([capture('f1', 'listing.html', 'https://boards.example.com/jobs/1')])
    expect(postingSourceForUrl(g, 'https://boards.example.com/jobs/1/')?.fileId).toBe('f1')
  })

  it('returns null for an application typed in without a link', () => {
    const g = graph([capture('f1', 'listing.html', 'https://boards.example.com/jobs/1')])
    expect(postingSourceForUrl(g, undefined)).toBeNull()
  })

  it('does not reach for the CV when there is no address', () => {
    // The same guard the application path has: without the null check, every
    // record with no URL would match every page with no `sourceUrl`.
    expect(postingSourceForUrl(graph([written('f1', 'CV.pdf')]), undefined)).toBeNull()
  })

  it('takes the newest capture of the same listing', () => {
    // A second capture of one URL is a re-read of a listing that changed, and
    // the later one is what the person is applying against.
    const g = graph([
      capture('f1', 'listing.html', 'https://boards.example.com/jobs/1'),
      capture('f2', 'listing-reposted.html', 'https://boards.example.com/jobs/1'),
    ])
    expect(postingSourceForUrl(g, 'https://boards.example.com/jobs/1')?.fileId).toBe('f2')
  })
})
