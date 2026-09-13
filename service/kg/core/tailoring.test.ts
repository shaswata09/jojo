/**
 * Which documents the tailoring card offers, and which snippets it lists.
 *
 * Both are read off the graph, and both have a wrong answer that looks right:
 * a job posting offered as a document to tailor, and a hand-filed snippet
 * listed as something a model wrote. Under D20 the card cannot be mounted, so
 * the two selectors are held here.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from './snapshot'
import type { StoredNode } from './model'
import { candidatesFor, TAG_FOR_KIND, tailoredFor, titleFor } from './tailoring'

const AT = '2026-09-13T09:00:00.000Z'

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
  return m
}

const file = (id: string, name: string, bucket = 'Applications') =>
  node(id, 'file', {
    slug: id,
    name,
    kind: 'pdf',
    bucket,
    size: '1 KB',
    savedOn: '2026-09-13',
    uri: `file:///${id}`,
  })

const app = (id: string) =>
  node(id, 'application', {
    slug: id,
    org: 'Rice',
    role: 'Assistant professor',
    roleTag: 'x',
    stage: 'draft',
    note: '',
    lastAction: 'x',
    lastActionAt: AT,
  })

const snippet = (id: string, tailored?: { source: string }) =>
  node(id, 'snippet', {
    slug: id,
    title: 'CV — Rice',
    tag: 'CV',
    body: 'x',
    ...(tailored ? { tailored: { ...tailored, kind: 'cv', model: 'm', at: AT } } : {}),
  })

describe('the documents on offer', () => {
  it("lists the person's own documents in packet order, classified by name", () => {
    const m = graph([
      file('file:cover', 'Cover letter — Meridian.pdf'),
      file('file:cv', 'Raghunathan-CV-2026.pdf'),
      file('file:teach', 'Teaching-Statement.pdf'),
      file('file:res', 'Research-Statement.pdf'),
      file('file:misc', 'Diversity statement.pdf'),
      app('application:a'),
    ])
    const got = candidatesFor(m, 'application:a')
    expect(got.map((c) => c.kind)).toEqual([
      'cv',
      'research-statement',
      'teaching-statement',
      'cover-letter',
      'other',
    ])
    expect(got[0]?.label).toBe('CV')
    expect(got.every((c) => !c.already)).toBe(true)
  })

  it('never offers a job posting', () => {
    // The posting is what the document is tailored FOR; tailoring it to itself
    // is the wrong answer that would look most like a result.
    const m = graph([
      file('file:post', 'Assistant Professor — CS.html', 'Job postings'),
      app('application:a'),
    ])
    expect(candidatesFor(m, 'application:a')).toEqual([])
  })

  it('skips a record with no bytes behind it', () => {
    // A restored backup on a machine that never held the file: a name and no
    // document. Offering it would spend a click to be told there is nothing.
    const bare = node('file:bare', 'file', {
      slug: 'b',
      name: 'CV.pdf',
      kind: 'pdf',
      bucket: 'Applications',
      size: '1 KB',
      savedOn: '2026-09-13',
    })
    const m = graph([bare, app('application:a')])
    expect(candidatesFor(m, 'application:a')).toEqual([])
  })

  it('marks a document already tailored for THIS application', () => {
    const m = graph(
      [
        file('file:cv', 'CV.pdf'),
        file('file:res', 'Research statement.pdf'),
        app('application:a'),
        app('application:b'),
        snippet('snippet:s1', { source: 'file:cv' }),
      ],
      [{ from: 'snippet:s1', rel: 'FILED_UNDER', to: 'application:a' }],
    )
    expect(candidatesFor(m, 'application:a').map((c) => [c.kind, c.already])).toEqual([
      ['cv', true],
      ['research-statement', false],
    ])
    // Per application: the same CV is untailored for the other job.
    expect(candidatesFor(m, 'application:b').every((c) => !c.already)).toBe(true)
  })
})

describe('what the card lists', () => {
  it('lists only tailored snippets filed under the application, newest first', () => {
    const m = graph(
      [
        app('application:a'),
        snippet('snippet:0001', { source: 'file:cv' }),
        snippet('snippet:0002'),
        snippet('snippet:0003', { source: 'file:res' }),
        snippet('snippet:0004', { source: 'file:cv' }),
      ],
      [
        { from: 'snippet:0001', rel: 'FILED_UNDER', to: 'application:a' },
        // A snippet the person filed by hand: theirs, and not this card's.
        { from: 'snippet:0002', rel: 'FILED_UNDER', to: 'application:a' },
        { from: 'snippet:0003', rel: 'FILED_UNDER', to: 'application:a' },
        // Tailored, but for another job.
      ],
    )
    expect(tailoredFor(m, 'application:a').map((n) => n.id)).toEqual([
      'snippet:0003',
      'snippet:0001',
    ])
  })
})

describe('naming', () => {
  it('files each kind under a tag that names the document', () => {
    expect(TAG_FOR_KIND.cv).toBe('CV')
    expect(TAG_FOR_KIND['cover-letter']).toBe('Cover letter')
    expect(TAG_FOR_KIND.other).toBe('Application form')
  })

  it('titles a snippet after the kind and the employer', () => {
    expect(titleFor('cv', 'Rice University')).toBe('CV — Rice University')
    expect(titleFor('research-statement', '  ')).toBe('Research statement')
  })
})
