/**
 * The tool layer's core contract, asserted the same way for every tool:
 * run it, check the graph changed as intended, undo it, and check the graph is
 * byte-identical to what it was before.
 *
 * That round trip is the whole claim of D12. An inverse-command undo passes the
 * first half of it and fails the second — an inverse `create` mints a new id and
 * leaves every edge that pointed at the old one dangling, which reads as a
 * successful undo and is not one. `sameGraph` below compares the entire node and
 * edge set, not the fields the test happened to think of.
 *
 * The clock is injected and fixed, so a tool that stamps a date is deterministic
 * (D26). Nothing here imports `TODAY`, and nothing here imports `kg/storage`:
 * the driver's type is read off `createRepository`'s own signature, so the test
 * names no module the layer rule forbids it to name.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import {
  FILE_BUCKET_VALUES,
  FILE_KIND_VALUES,
  LABEL_TONE_VALUES,
  LINK_CATEGORY_VALUES,
  OUTCOME_VALUES,
  ROLES,
  SNIPPET_TAG_VALUES,
  SOURCES,
  STAGE_VALUES,
  TIMELINE_KIND_VALUES,
  URGENCY_VALUES,
} from '../core/model'
import type { StoredEdge, StoredNode } from '../core/model'
import { createRepository } from '../repo/repository'
import type { Repository } from '../repo/repository'
import { TOOLS } from './index'
import { createToolRuntime } from './runtime'
import { dayOf, displayOf } from './support'

type Options = Parameters<typeof createRepository>[0]

/**
 * A driver that accepts everything and remembers nothing.
 *
 * Durability is Wave 2 and is not what these tests are about — but the real
 * repository is, because the undo and redo rings are its bookkeeping and a
 * hand-written fake would be testing the fake.
 */
const nullDriver = (): Options['driver'] => ({
  // Written as literals rather than through `ok()`: the driver has its own
  // narrower failure type, so a `Result<T>` carrying a `KgErrorCode` is not the
  // same shape and the ok branch would drag the wrong error union with it.
  open: async () => ({ ok: true, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true, value: undefined }),
  replace: async () => ({ ok: true, value: undefined }),
  // `true` means "the store was pristine and I seeded it", which is the answer a
  // driver that remembers nothing can always give honestly.
  seedIfPristine: async () => ({ ok: true, value: true }),
  destroy: async () => ({ ok: true, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

const START = Date.parse('2026-10-12T15:00:00.000Z')

function harness() {
  // Advanced by a second per read so ids stay ordered and `lastActionAt` moves,
  // which is what `ofType`'s "id-ascending is creation order" depends on.
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()

  const meta: Options['meta'] = {
    schemaVersion: 1,
    createdAt: new Date(START).toISOString(),
    lastOpenedAt: new Date(START).toISOString(),
    dataSet: 'empty',
    seededAt: null,
  }

  const repo = createRepository({
    driver: nullDriver(),
    snapshot: new MutableSnapshot(),
    meta,
    now,
  })

  return { repo, runtime: createToolRuntime({ repo, now }), now }
}

/** Every node and every edge, order-independent. The undo contract in one value. */
function graphOf(repo: Repository) {
  const m = repo.getSnapshot()
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
  return {
    nodes: [...(m.nodes() as StoredNode[])].sort(byId),
    edges: [...(m.edges() as StoredEdge[])].sort(byId),
  }
}

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}

/* -------------------------------------------------------------------------- */

describe('the round trip', () => {
  it('creates an application, its employer and its deadline in ONE commit', () => {
    const h = harness()
    const before = graphOf(h.repo)

    const keyword = okOr(h.runtime.run('keyword.create', { name: 'Referral' }))
    const afterKeyword = graphOf(h.repo)

    const result = h.runtime.run('application.create', {
      org: 'Rice',
      role: 'Assistant professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
      deadline: '2026-11-01',
      keywords: [keyword],
    })
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))

    const m = h.repo.getSnapshot()
    expect(m.ofType('application')).toHaveLength(1)
    expect(m.ofType('organisation')).toHaveLength(1)
    expect(m.ofType('timelineItem')).toHaveLength(1)
    expect(m.one(result.output, 'AT', 'organisation')?.props.name).toBe('Rice')
    expect(m.many(result.output, 'TAGS', 'in', 'keyword')).toHaveLength(1)

    // One user action, one journal row — not four.
    expect(h.repo.undoable).toHaveLength(2)
    // Newest first.
    expect(h.repo.undoable[0]?.calls).toContain('org.ensure')
    expect(h.repo.undoable[0]?.calls).toContain('timeline.item.create')

    // The whole composite comes back, including the employer and the deadline.
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(afterKeyword)

    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  it('restores an application AND its edges after a delete', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Stripe',
        role: 'ML engineer',
        roleTag: 'ML Engineer',
        stage: 'draft',
      }),
    )
    okOr(
      h.runtime.run('vault.link.save', {
        title: 'Stripe — ML engineer',
        url: 'https://stripe.com/jobs/1',
        category: 'Posting',
        applicationId: app,
      }),
    )
    const before = graphOf(h.repo)

    okOr(h.runtime.run('application.delete', { id: app }))

    // Unlink, never cascade: the link survives, carrying no application.
    const m = h.repo.getSnapshot()
    expect(m.ofType('application')).toHaveLength(0)
    expect(m.ofType('link')).toHaveLength(1)
    expect(m.edges().filter((e) => e.rel === 'FILED_UNDER')).toHaveLength(0)

    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  it('round-trips every one-field tool', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Baylor',
        role: 'CS',
        roleTag: 'Assistant Professor',
        stage: 'offer',
      }),
    )
    const item = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Baylor — respond to offer',
        date: '2026-11-15',
        kind: 'deadline',
        applicationId: app,
      }),
    )
    const keyword = okOr(h.runtime.run('keyword.create', { name: 'Negotiating' }))

    const cases: [keyof typeof TOOLS, Record<string, unknown>][] = [
      ['application.note.set', { id: app, note: 'Negotiating startup package' }],
      ['application.flag.set', { id: app, flagged: true }],
      ['application.stage.set', { id: app, stage: 'closed' }],
      ['application.duplicate', { id: app }],
      ['timeline.item.complete', { id: item }],
      ['timeline.item.snooze', { id: item, days: 3 }],
      ['timeline.item.reschedule', { id: item, date: '2026-12-01' }],
      ['timeline.item.remind.set', { id: item, remind: true }],
      ['timeline.item.duplicate', { id: item }],
      ['timeline.item.delete', { id: item }],
      ['keyword.attach', { record: app, keyword }],
      ['keyword.record.set', { record: app, keywords: [keyword] }],
      ['keyword.rename', { id: keyword, name: 'In negotiation' }],
      ['keyword.tone.set', { id: keyword, tone: 'amber' }],
      ['keyword.delete', { id: keyword }],
    ]

    for (const [name, input] of cases) {
      const before = graphOf(h.repo)
      const result = h.runtime.run(name, input as never)
      if (!result.ok) throw new Error(`${name}: ${result.errors.map((e) => e.message).join('; ')}`)
      h.runtime.undo()
      expect(graphOf(h.repo), `${name} did not undo cleanly`).toEqual(before)
    }
  })
})

describe('the transaction', () => {
  it('discards every write when a nested tool fails', () => {
    const h = harness()
    okOr(h.runtime.run('keyword.create', { name: 'Read' }))
    const before = graphOf(h.repo)
    const journalDepth = h.repo.undoable.length

    // The keyword id is well-formed but points at nothing, so `keyword.record.set`
    // fails AFTER the application and its organisation have been written.
    const result = h.runtime.run('application.create', {
      org: 'UNT',
      role: 'Assistant professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
      keywords: ['kw:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'],
    })

    expect(result.ok).toBe(false)
    expect(graphOf(h.repo)).toEqual(before)
    expect(h.repo.undoable).toHaveLength(journalDepth)
  })

  /**
   * The INPUT schema refuses this, and it is worth being clear that that is all
   * it proves.
   *
   * This case was named "rejects an edge the schema does not allow" and read as
   * cover for `EDGE_SCHEMA`; it is not. `keyword.attach`'s `keyword` field is
   * `s.id('keyword')`, so an `app:` id never survives parsing and `tx.link` is
   * never reached — deleting the `EDGE_SCHEMA` check from `runtime-tx.ts` left
   * this green. Both layers are worth having, and both are worth testing: the
   * `tx.link` half is in `transaction.test.ts`, where the call can be made
   * without a schema in front of it.
   */
  it('rejects a badly-typed id before it becomes an edge', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'UH',
        role: '',
        roleTag: 'Researcher',
        stage: 'draft',
      }),
    )
    // An application is not taggable-by-application; TAGS goes keyword -> record.
    const result = h.runtime.run('keyword.attach', { record: app, keyword: app })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.field).toBe('keyword')
  })

  it('mints distinct slugs for records created in the SAME transaction', () => {
    const h = harness()
    const ids = okOr(
      h.runtime.run('vault.file.add', {
        files: [
          { name: 'CV 2026.pdf', kind: 'pdf', bucket: 'To read', size: '1 KB' },
          { name: 'CV 2026.pdf', kind: 'pdf', bucket: 'To read', size: '2 KB' },
          { name: 'CV 2026.pdf', kind: 'pdf', bucket: 'To read', size: '3 KB' },
        ],
      }),
    )
    const m = h.repo.getSnapshot()
    const slugs = ids.map((id) => m.node(id, 'file')?.props.slug)
    expect(new Set(slugs).size).toBe(3)
    expect(slugs).toEqual(['cv-2026.pdf', 'cv-2026.pdf-2', 'cv-2026.pdf-3'])
    // One drop is one commit and one Undo, not three.
    expect(h.repo.undoable).toHaveLength(1)
  })

  /**
   * The slug a record is ADDRESSED by, when a composite minted another record
   * named the same thing first.
   *
   * `application.create` calls `org.ensure` through `ctx.call`, so both records
   * are minted inside one transaction and both fold to 'rice'. The pending set
   * `ctx.mintSlug` keeps was flat across that transaction, so the organisation
   * took 'rice' and the application — the record whose slug IS its URL
   * (`core/address.ts`) — took 'rice-2'. Every first job at a new employer was
   * addressed `/applications/rice-2`, on a store holding no other Rice.
   *
   * Slugs are unique per [type, slug] (D4), so there was never a collision to
   * avoid: the two records may both be 'rice' and the index keeps them apart.
   * Asserted on BOTH types, because a fix that scoped the pending set the wrong
   * way round would move the number onto the organisation instead.
   */
  it('addresses the first application at a new employer by the employer name', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Assistant professor',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    )

    const m = h.repo.getSnapshot()
    expect(m.node(app, 'application')?.props.slug).toBe('rice')
    expect(m.ofType('organisation').map((n) => n.props.slug)).toEqual(['rice'])
    // The [type, slug] index keeps two records answering to one name apart.
    expect(m.bySlug('application', 'rice')?.id).toBe(app)
    expect(m.bySlug('organisation', 'rice')?.type).toBe('organisation')
  })

  it('rejects input before it touches memory', () => {
    const h = harness()
    const before = graphOf(h.repo)
    const result = h.runtime.run('application.create', {
      org: '   ',
      role: '',
      roleTag: 'Postdoc',
      stage: 'draft',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.field).toBe('org')
    expect(graphOf(h.repo)).toEqual(before)
  })

  it('re-throws a programmer error rather than laundering it into a toast', () => {
    const h = harness()
    const broken = { ...TOOLS['keyword.tone.set'] }
    // Reaching into the registry is the only way to stage a genuine bug; the
    // point being asserted is that `run` does NOT catch this.
    Object.defineProperty(broken, 'run', {
      value: () => {
        throw new TypeError('undefined is not a function')
      },
    })
    const registry = TOOLS as unknown as Record<string, unknown>
    const original = registry['keyword.tone.set']
    registry['keyword.tone.set'] = broken
    try {
      const id = okOr(h.runtime.run('keyword.create', { name: 'Read' }))
      expect(() => h.runtime.run('keyword.tone.set', { id, tone: 'red' })).toThrow(TypeError)
    } finally {
      registry['keyword.tone.set'] = original
    }
  })
})

describe('the clock', () => {
  it('stamps a completion from ctx.now, never from the wall clock', () => {
    const h = harness()
    const item = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'UT Austin statements',
        date: '2026-10-04',
        kind: 'deadline',
      }),
    )
    okOr(h.runtime.run('timeline.item.complete', { id: item }))
    const completedOn = h.repo.getSnapshot().node(item, 'timelineItem')?.props.completedOn
    expect(completedOn).toBe(dayOf(new Date(START).toISOString()))
  })

  it('counts a snooze from today when the item is already overdue', () => {
    const h = harness()
    const today = dayOf(new Date(START).toISOString())
    const item = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Overdue',
        date: '2026-09-01',
        kind: 'admin',
      }),
    )
    const moved = okOr(h.runtime.run('timeline.item.snooze', { id: item, days: 1 }))
    // Not 2026-09-02: "snooze a day" on something six weeks late must not leave
    // it six weeks late.
    expect(moved > today).toBe(true)
  })

  it('deletes completedOn on reopen rather than storing a null', () => {
    const h = harness()
    const item = okOr(
      h.runtime.run('timeline.item.create', { title: 'Prep', date: '2026-10-20', kind: 'prep' }),
    )
    okOr(h.runtime.run('timeline.item.complete', { id: item }))
    okOr(h.runtime.run('timeline.item.reopen', { id: item }))
    const props = h.repo.getSnapshot().node(item, 'timelineItem')?.props ?? {}
    expect('completedOn' in props).toBe(false)
  })
})

describe('identity and dedupe', () => {
  it('joins two applications at one employer', () => {
    const h = harness()
    const a = okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Statistics',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    )
    const b = okOr(
      h.runtime.run('application.create', {
        org: '  rice ',
        role: 'CS',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    )
    const m = h.repo.getSnapshot()
    expect(m.ofType('organisation')).toHaveLength(1)
    expect(m.one(a, 'AT', 'organisation')?.id).toBe(m.one(b, 'AT', 'organisation')?.id)
  })

  it('refuses a rename onto a name that is taken', () => {
    const h = harness()
    okOr(h.runtime.run('keyword.create', { name: 'Referral' }))
    const other = okOr(h.runtime.run('keyword.create', { name: 'Research' }))
    const result = h.runtime.run('keyword.rename', { id: other, name: 'referral' })
    expect(result.ok).toBe(false)
    expect(h.repo.getSnapshot().node(other, 'keyword')?.props.name).toBe('Research')
  })

  it('writes COPY_OF and drops the offer when duplicating', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Baylor',
        role: 'CS',
        roleTag: 'Assistant Professor',
        stage: 'offer',
      }),
    )
    okOr(
      h.runtime.run('application.stage.advance', {
        id: app,
        stage: 'offer',
        offer: { respondBy: '2026-11-15', note: 'Negotiating' },
      }),
    )
    const copy = okOr(h.runtime.run('application.duplicate', { id: app }))

    const m = h.repo.getSnapshot()
    expect(m.one(copy, 'COPY_OF', 'application')?.id).toBe(app)
    expect(m.node(copy, 'application')?.props.stage).toBe('draft')
    expect('offer' in (m.node(copy, 'application')?.props ?? {})).toBe(false)
    expect(m.node(app, 'application')?.props.offer?.respondBy).toBe('2026-11-15')
  })
})

describe('the composites', () => {
  it('moves the deadline it owns and leaves other dated items alone', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Statistics',
        roleTag: 'Assistant Professor',
        stage: 'draft',
        deadline: '2026-11-01',
      }),
    )
    // A second deadline on the same application, of the user's own making.
    const theirs = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Rice — reference letters',
        date: '2026-10-25',
        kind: 'deadline',
        applicationId: app,
      }),
    )

    okOr(h.runtime.run('application.update', { id: app, deadline: '2026-11-08' }))
    const m = h.repo.getSnapshot()
    const dated = m.many(app, 'ABOUT', 'in', 'timelineItem')
    expect(dated).toHaveLength(2)
    expect(m.node(theirs, 'timelineItem')?.props.date).toBe('2026-10-25')
    expect(dated.find((i) => i.id !== theirs)?.props.date).toBe('2026-11-08')

    // Clearing the field deletes the form's item and only that one.
    okOr(h.runtime.run('application.update', { id: app, deadline: null }))
    const after = h.repo.getSnapshot()
    expect(after.many(app, 'ABOUT', 'in', 'timelineItem')).toHaveLength(1)
    expect(after.node(theirs, 'timelineItem')).toBeDefined()
  })

  it('does not touch the deadline when the field was not in the input', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'UH',
        role: 'CS',
        roleTag: 'Assistant Professor',
        stage: 'draft',
        deadline: '2026-11-01',
      }),
    )
    okOr(h.runtime.run('application.update', { id: app, location: 'Houston, TX' }))
    // A save that always wrote minted a second deadline on every edit.
    expect(h.repo.getSnapshot().ofType('timelineItem')).toHaveLength(1)
  })

  it('promotes a posting to an application and links the two', () => {
    const h = harness()
    const posting = okOr(
      h.runtime.run('scout.posting.save', { url: 'https://jobs.rice.edu/postings/ml-engineer' }),
    )
    const before = graphOf(h.repo)
    const app = okOr(h.runtime.run('scout.posting.promote', { id: posting }))

    const m = h.repo.getSnapshot()
    // The employer comes off the hostname, not off the title.
    expect(m.one(app, 'AT', 'organisation')?.props.name).toBe('Rice')
    expect(m.node(app, 'application')?.props.stage).toBe('draft')
    // Linked, not consumed: the posting stays filed.
    expect(m.node(posting, 'posting')).toBeDefined()
    expect(m.one(posting, 'BECAME', 'application')?.id).toBe(app)

    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  /**
   * The seeded Rice posting, promoted. Its URL names the employer and nothing
   * else — every path segment is routing or a record number — so this used to
   * produce an application displayed as bare 'Rice' with an empty Role, with the
   * job title sitting unread in the row that had just been pressed.
   */
  it('seeds the role from the posting title when the URL names no job', () => {
    const h = harness()
    const posting = okOr(
      h.runtime.run('scout.posting.save', {
        url: 'jobs.rice.edu/postings/29411',
        title: 'Assistant Professor of Computer Science — Rice University',
      }),
    )
    const app = okOr(h.runtime.run('scout.posting.promote', { id: posting }))

    const m = h.repo.getSnapshot()
    // Still off the hostname: the title spells the employer last, and reading it
    // from there files the application under a job title.
    expect(m.one(app, 'AT', 'organisation')?.props.name).toBe('Rice')
    expect(m.node(app, 'application')?.props.role).toBe('Assistant Professor of Computer Science')
    expect(displayOf(m, app)).toBe('Rice — Assistant Professor of Computer Science')
  })

  // The URL is the more structured source, so a job spelled in the path is not
  // overridden by whatever prose the title carries.
  it('prefers the job the URL names over the one the title does', () => {
    const h = harness()
    const posting = okOr(
      h.runtime.run('scout.posting.save', {
        url: 'https://jobs.rice.edu/postings/ml-engineer',
        title: 'Something else entirely — Rice University',
      }),
    )
    const app = okOr(h.runtime.run('scout.posting.promote', { id: posting }))
    expect(h.repo.getSnapshot().node(app, 'application')?.props.role).toBe('ML engineer')
  })

  it('promotes a match, splitting the packed employer and role', () => {
    const h = harness()
    okOr(h.runtime.run('memory.reset', {}))
    const match = h.repo.getSnapshot().ofType('match')[0]
    if (!match) throw new Error('the seed has no matches')

    const app = okOr(h.runtime.run('scout.match.promote', { id: match.id }))
    const m = h.repo.getSnapshot()
    expect(m.node(app, 'application')?.props.source).toBe('Job scout')
    expect(m.one(match.id, 'BECAME', 'application')?.id).toBe(app)
    expect(m.one(app, 'AT', 'organisation')?.props.name.length).toBeGreaterThan(0)
  })

  it('mints the interview a stage change promised', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Stripe',
        role: 'ML engineer',
        roleTag: 'ML Engineer',
        stage: 'submitted',
      }),
    )
    const before = graphOf(h.repo)

    okOr(
      h.runtime.run('application.stage.advance', {
        id: app,
        stage: 'interview',
        lastAction: 'Onsite interview scheduled',
        mint: {
          title: 'Stripe — ML engineer — onsite interview',
          date: '2026-10-30',
          kind: 'interview',
          urgency: 'amber',
        },
      }),
    )

    const m = h.repo.getSnapshot()
    expect(m.node(app, 'application')?.props.stage).toBe('interview')
    expect(m.many(app, 'ABOUT', 'in', 'timelineItem')).toHaveLength(1)
    // One commit: a failure between the two used to leave an application at
    // Interview with no interview on the calendar.
    expect(h.repo.undoable[0]?.calls).toContain('timeline.item.create')

    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  it('files a profile document in the bucket the profile page reads', () => {
    const h = harness()
    okOr(
      h.runtime.run('profile.document.add', {
        files: [{ name: 'CV.pdf', kind: 'pdf', size: '184 KB' }],
      }),
    )
    expect(h.repo.getSnapshot().ofType('file')[0]?.props.bucket).toBe('Applications')
  })
})

describe('the admin tools', () => {
  it('reset loads the demo fixtures and cannot be undone', () => {
    const h = harness()
    const result = h.runtime.run('memory.reset', {})
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))

    const m = h.repo.getSnapshot()
    expect(m.ofType('application').length).toBeGreaterThan(0)
    expect(m.ofType('keyword').length).toBeGreaterThan(0)
    expect(m.ofType('timelineItem').length).toBeGreaterThan(0)
    expect(m.edges().some((e) => e.rel === 'TAGS')).toBe(true)
    expect(m.edges().some((e) => e.rel === 'AT')).toBe(true)

    // Every edge has both ends. R-2's integrity check, asserted on the seed.
    for (const edge of m.edges()) {
      expect(m.node(edge.from), `dangling from on ${edge.id}`).toBeDefined()
      expect(m.node(edge.to), `dangling to on ${edge.id}`).toBeDefined()
    }

    // No derived value reached storage.
    for (const node of m.nodes()) {
      const props = node.props as Record<string, unknown>
      expect('daysAgo' in props).toBe(false)
      expect('allDay' in props).toBe(false)
      expect('linked' in props).toBe(false)
      expect('applicationId' in props).toBe(false)
    }

    expect(result.undo).toBeNull()
    expect(h.repo.undoable).toHaveLength(0)
  })

  it('clear empties the records and keeps the keywords', () => {
    const h = harness()
    okOr(h.runtime.run('memory.reset', {}))
    const keywords = h.repo.getSnapshot().ofType('keyword').length

    okOr(h.runtime.run('memory.clear', {}))
    const m = h.repo.getSnapshot()
    expect(m.ofType('application')).toHaveLength(0)
    expect(m.ofType('timelineItem')).toHaveLength(0)
    expect(m.ofType('link')).toHaveLength(0)
    expect(m.ofType('keyword')).toHaveLength(keywords)
    expect(m.ofType('profile')[0]?.props.text.fullName).toBe('')
  })
})

describe('the registry', () => {
  it('files every tool under the name it answers to', () => {
    for (const [key, tool] of Object.entries(TOOLS)) expect(tool.name).toBe(key)
  })

  it('gives every tool a title, a summary and something it touches', () => {
    for (const tool of Object.values(TOOLS)) {
      expect(tool.title.length, tool.name).toBeGreaterThan(0)
      expect(tool.summary.length, tool.name).toBeGreaterThan(0)
      expect(tool.touches.length, tool.name).toBeGreaterThan(0)
    }
  })

  /**
   * Every value the model declares for a persisted union is a value the tool
   * that owns that field will accept.
   *
   * Nine of the eleven closed unions used to be re-spelled as fresh literals in
   * `kg/tools`, guarded by `satisfies` — which asserts every element IS a member
   * and says nothing about every member being present, so a SHORTER list
   * compiled. `core/validate.ts` reads the model's consts, so the two halves of
   * the same model disagreed: a newly-added kind loaded off disk and rendered,
   * and the tool that owns the record refused to write it. Journal replay
   * bypasses schemas, so undo put it back — a value in the graph no tool could
   * produce.
   *
   * `check` rather than `run`: this is a question about the SCHEMA, and parsing
   * is the stage where the disagreement lived. Adding a twelfth union means
   * adding a row here; leaving one out is the only way back to the bug.
   */
  it('accepts every value the model declares for the unions tools write', () => {
    const h = harness()
    const parses = (name: Parameters<typeof h.runtime.check>[0], input: unknown) =>
      h.runtime.check(name, input).ok

    // Well-formed but absent: `check` parses and does not touch memory.
    const APP = 'app:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'
    const KW = 'kw:0192f4c1-7b3e-7a41-9c2d-8f5e1a0b6d33'
    const draft = { org: 'Rice', role: 'CS', roleTag: 'Assistant Professor' as const }
    for (const stage of STAGE_VALUES) {
      expect(parses('application.create', { ...draft, stage }), stage).toBe(true)
      expect(parses('application.stage.set', { id: APP, stage }), stage).toBe(true)
    }
    for (const outcome of OUTCOME_VALUES) {
      expect(parses('application.update', { id: APP, outcome }), outcome).toBe(true)
      // `application.stage.advance` too, and it is the one that matters most:
      // it is what the Closed-transition dialog calls, and it owns the second
      // spelling of this union. Covering outcomes only through `update` left a
      // mutation that shortens `application-stage.ts`'s list passing the whole
      // suite — meaning the user could not record "Ghosted" from the single
      // screen that asks for it, and nothing would have said so.
      //
      // NOT `application.stage.set`: a first attempt asserted against that tool,
      // whose input is `{ id, stage }` with no outcome at all, so the extra key
      // was ignored and the assertion could never fail — fixing a report about
      // vacuous tests with a vacuous test.
      expect(
        parses('application.stage.advance', { id: APP, stage: 'closed', outcome }),
        outcome,
      ).toBe(true)
    }
    for (const roleTag of ROLES) {
      expect(parses('application.create', { ...draft, roleTag, stage: 'draft' }), roleTag).toBe(
        true,
      )
    }
    for (const source of SOURCES) {
      expect(parses('application.update', { id: APP, source }), source).toBe(true)
    }

    for (const kind of TIMELINE_KIND_VALUES) {
      expect(parses('timeline.item.create', { title: 'T', date: '2026-11-01', kind }), kind).toBe(
        true,
      )
    }
    for (const urgency of URGENCY_VALUES) {
      expect(
        parses('timeline.item.create', {
          title: 'T',
          date: '2026-11-01',
          kind: 'admin',
          urgency,
        }),
        urgency,
      ).toBe(true)
    }

    for (const category of LINK_CATEGORY_VALUES) {
      expect(parses('vault.link.save', { title: 'L', url: 'u', category }), category).toBe(true)
    }
    for (const bucket of FILE_BUCKET_VALUES) {
      const file = { name: 'f.pdf', kind: 'pdf' as const, size: '1 KB', bucket }
      expect(parses('vault.file.add', { files: [file] }), bucket).toBe(true)
    }
    for (const kind of FILE_KIND_VALUES) {
      const file = { name: 'f', kind, size: '1 KB', bucket: 'To read' as const }
      expect(parses('vault.file.add', { files: [file] }), kind).toBe(true)
    }
    for (const tag of SNIPPET_TAG_VALUES) {
      expect(parses('vault.snippet.create', { title: 'S', body: 'b', tag }), tag).toBe(true)
    }
    for (const tone of LABEL_TONE_VALUES) {
      expect(parses('keyword.tone.set', { id: KW, tone }), tone).toBe(true)
    }
  })

  it('offers a node only the tools that touch its type', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'UNT',
        role: 'ML',
        roleTag: 'ML Engineer',
        stage: 'draft',
      }),
    )
    const names = h.runtime.forNode(app).map((t) => t.name)
    expect(names).toContain('application.delete')
    expect(names).not.toContain('vault.link.save')
    // `org.ensure` is internal and never offered as a verb on a node.
    expect(names).not.toContain('org.ensure')
  })
})

describe('what the user is told', () => {
  /**
   * The toast title and the journal label are `describe().title`, and they are
   * the same string.
   *
   * Nothing else in the suite reads one. `run` could pass the tool NAME as the
   * label and every other assertion here would still hold — the graph would be
   * right and the Undo toast would read `application.create` instead of *"Rice
   * — Statistics added"*, in the toast, in the Undo menu and in every audit row
   * for that session. `defineTool({ title, summary })` is checked by the palette
   * because the palette generates forms from it; `describe()` is copy with
   * nothing downstream of it but the user's eyes.
   */
  it('labels the toast and the journal row with the tool’s own describe()', () => {
    const h = harness()

    const result = h.runtime.run('application.create', {
      org: 'Rice',
      role: 'Statistics',
      roleTag: 'Assistant Professor',
      stage: 'draft',
      deadline: '2026-11-01',
    })
    if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))

    expect(result.announcement.title).toBe('Rice — Statistics added')
    expect(result.announcement.description).toBe('Deadline Nov 1 is on the calendar.')
    // The same string, because the Undo toast and the audit row are one label.
    expect(h.repo.undoable[0]?.label).toBe('Rice — Statistics added')

    // And it names what was just made, from the overlay: the commit has not
    // happened when `describe` runs, so reading the committed snapshot instead
    // would leave every create announcing an empty name.
    expect(result.announcement.title).not.toBe(' added')
  })

  it('carries the label through undo, so the toast says what is being put back', () => {
    const h = harness()
    okOr(h.runtime.run('keyword.create', { name: 'Referral' }))

    const undone = h.runtime.undo()

    expect(undone.ok).toBe(true)
    if (undone.ok) {
      expect(undone.announcement.title).toBe('Undone')
      expect(undone.announcement.description).toBe('Referral added')
    }
  })
})

describe('the nesting guards', () => {
  /**
   * A tool that calls itself is refused rather than allowed to blow the stack.
   *
   * Staged the same way `re-throws a programmer error` stages one, and for the
   * same reason: no honest tool does this, so the only way to reach the guard is
   * to write the bug it exists for. The failure it prevents is a
   * RangeError out of a click handler — the ErrorBoundary, a blank screen, and
   * a transaction buffer nobody discarded.
   *
   * The MESSAGE is asserted, not just the refusal. `MAX_DEPTH` is eight calls
   * below this guard and refuses with the same `graph/invariant` code, so a test
   * that only checked `ok: false` would stay green with the cycle check deleted
   * and report the wrong cause: "too many nested operations" sends the next
   * reader looking for a long chain that is not there.
   */
  it('refuses a tool that calls itself instead of recursing until the stack goes', () => {
    const h = harness()
    const registry = TOOLS as unknown as Record<string, unknown>
    const original = TOOLS['keyword.tone.set']
    const looping = { ...original }
    Object.defineProperty(looping, 'run', {
      value: (ctx: { call: (n: string, i: unknown) => unknown }, input: unknown) =>
        ctx.call('keyword.tone.set', input),
    })
    registry['keyword.tone.set'] = looping
    try {
      const id = okOr(h.runtime.run('keyword.create', { name: 'Read' }))
      const result = h.runtime.run('keyword.tone.set', { id, tone: 'red' })
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.errors[0]?.message).toBe(`${original.title} called itself.`)
        expect(result.errors[0]?.code).toBe('graph/invariant')
      }
    } finally {
      registry['keyword.tone.set'] = original
    }
  })
})

describe('redo', () => {
  it('replays what undo took back', () => {
    const h = harness()
    okOr(h.runtime.run('keyword.create', { name: 'Read' }))
    const after = graphOf(h.repo)

    h.runtime.undo()
    h.runtime.redo()
    expect(graphOf(h.repo)).toEqual(after)
  })

  it('refuses when there is nothing to undo', () => {
    const h = harness()
    expect(h.runtime.undo().ok).toBe(false)
  })
})
