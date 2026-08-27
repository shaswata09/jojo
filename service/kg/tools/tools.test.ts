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
  APPROVAL_MODES,
  DEFAULT_ROLES,
  approvalOf,
} from '../core/model'
import type { NodeId, StoredEdge, StoredNode } from '../core/model'
import { createRepository } from '../repo/repository'
import type { Repository } from '../repo/repository'
import { SCOUT_TOOLS, TWIN_TOOLS } from '../core/proposal'
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

function harness(snapshot: MutableSnapshot = new MutableSnapshot()) {
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
    handoverAt: null,
  }

  const repo = createRepository({
    driver: nullDriver(),
    snapshot,
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
        applicationIds: [app],
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
        applicationIds: [app],
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

/**
 * Duplicating something filed under more than one job.
 *
 * `FILED_UNDER` and `ABOUT` became `fromCardinality: 'many'`, and the three
 * duplicate tools kept copying the filing with `memory.one(...)` — which
 * returns the FIRST match and does not complain about the rest. So a CV filed
 * under three applications duplicated to a copy filed under one, silently, and
 * `vault.link.duplicate` went on summarising itself as "keeping its category
 * and where it is filed".
 *
 * That summary is not decoration: it is the description handed to the model as
 * a tool definition, so the agent was told the copy keeps its filing while the
 * copy quietly lost two thirds of it.
 *
 * Asserted as a SET of application ids rather than a count, because the failure
 * this is built to catch keeps exactly one of them and a count of one is what a
 * legitimately single-filed record has too.
 */
describe('duplicating a record filed under several applications', () => {
  const two = (h: ReturnType<typeof harness>) => [
    okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Statistics',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    ),
    okOr(
      h.runtime.run('application.create', {
        org: 'Baylor',
        role: 'CS',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    ),
  ]

  /** The applications a record points at, as a sorted set of ids. */
  const filedUnder = (h: ReturnType<typeof harness>, id: string, rel: 'FILED_UNDER' | 'ABOUT') =>
    h.repo
      .getSnapshot()
      .many(id, rel, 'out', 'application')
      .map((a) => a.id)
      .sort()

  it('keeps every application on a duplicated link', () => {
    const h = harness()
    const apps = two(h)
    const link = okOr(
      h.runtime.run('vault.link.save', {
        title: 'Reference letter tracker',
        url: 'https://example.org/tracker',
        category: 'Guide',
        applicationIds: apps,
      }),
    )
    expect(filedUnder(h, link, 'FILED_UNDER')).toEqual([...apps].sort())

    const copy = okOr(h.runtime.run('vault.link.duplicate', { id: link }))
    expect(filedUnder(h, copy, 'FILED_UNDER')).toEqual([...apps].sort())
  })

  it('keeps every application on a duplicated snippet', () => {
    const h = harness()
    const apps = two(h)
    const snippet = okOr(
      h.runtime.run('vault.snippet.create', {
        title: 'Teaching paragraph',
        tag: 'Cover letter',
        body: 'Dear [NAME],',
        applicationIds: apps,
      }),
    )
    const copy = okOr(h.runtime.run('vault.snippet.duplicate', { id: snippet }))
    expect(filedUnder(h, copy, 'FILED_UNDER')).toEqual([...apps].sort())
  })

  /**
   * People, which is the newest thing the Vault holds and the first record type
   * whose whole point is being filed under more than one job.
   *
   * A referee writes for every application you name them on. Every assertion
   * here is about that: the edges, what happens when the list is rewritten, and
   * that removing the person leaves the jobs alone.
   */
  it('files a person under every job they are named on', () => {
    const h = harness()
    const apps = two(h)
    const person = okOr(
      h.runtime.run('vault.person.create', {
        name: 'Anita Mehta',
        role: 'Referee',
        affiliation: 'Texas Tech',
        email: 'a.mehta@ttu.edu',
        applicationIds: apps,
      }),
    )
    expect(filedUnder(h, person, 'FILED_UNDER')).toEqual([...apps].sort())
  })

  it('replaces the filing rather than adding to it', () => {
    const h = harness()
    const apps = two(h)
    const person = okOr(
      h.runtime.run('vault.person.create', { name: 'D. Chen', applicationIds: apps }),
    )
    const kept = apps.slice(0, 1)
    okOr(h.runtime.run('vault.person.update', { id: person, applicationIds: kept }))
    expect(filedUnder(h, person, 'FILED_UNDER')).toEqual(kept)
  })

  it('stores nothing for a detail left blank, rather than an empty string', () => {
    // A note wiped in the form has to LEAVE the record. Stored as '', the Vault
    // renders a blank line under the name for ever and nothing can tell the
    // difference between "no note" and "a note somebody deleted".
    const h = harness()
    const person = okOr(h.runtime.run('vault.person.create', { name: 'Sam Alvarez', note: '   ' }))
    expect(h.repo.getSnapshot().node(person, 'person')?.props).not.toHaveProperty('note')

    okOr(h.runtime.run('vault.person.update', { id: person, role: 'Recruiter' }))
    expect(h.repo.getSnapshot().node(person, 'person')?.props.role).toBe('Recruiter')
    okOr(h.runtime.run('vault.person.update', { id: person, role: '' }))
    expect(h.repo.getSnapshot().node(person, 'person')?.props.role).toBeUndefined()
  })

  it('removing a person leaves the applications they were named on', () => {
    const h = harness()
    const apps = two(h)
    const person = okOr(
      h.runtime.run('vault.person.create', { name: 'Erik Lindqvist', applicationIds: apps }),
    )
    okOr(h.runtime.run('vault.person.delete', { id: person }))
    expect(h.repo.getSnapshot().node(person)).toBeUndefined()
    for (const app of apps) expect(h.repo.getSnapshot().node(app)).toBeDefined()
  })

  it('keeps every application on a duplicated timeline item', () => {
    const h = harness()
    const apps = two(h)
    const item = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Chase both referees',
        date: '2026-11-15',
        kind: 'follow-up',
        applicationIds: apps,
      }),
    )
    const copy = okOr(h.runtime.run('timeline.item.duplicate', { id: item }))
    expect(filedUnder(h, copy, 'ABOUT')).toEqual([...apps].sort())
  })

  it('undoes a duplicate that carried several edges, byte for byte', () => {
    const h = harness()
    const apps = two(h)
    const link = okOr(
      h.runtime.run('vault.link.save', {
        title: 'Reference letter tracker',
        url: 'https://example.org/tracker',
        category: 'Guide',
        applicationIds: apps,
      }),
    )
    // The undo contract is per-EDGE, and copying N edges instead of 1 is exactly
    // the change that can leave one behind on the way back out.
    const before = graphOf(h.repo)
    okOr(h.runtime.run('vault.link.duplicate', { id: link }))
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
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

  /**
   * Re-saving a document without changing its filing must not touch the edges.
   *
   * `fileUnder` used to unlink every FILED_UNDER edge and put them all back,
   * which reads as a set operation and behaves like one — but the relinked edge
   * carries a fresh `createdAt`, so a save that changed nothing produced a
   * journal entry that was not a no-op. It took the top of the undo ring and
   * cleared the redo stack, so one Ctrl+Z after an untouched save undid a
   * timestamp and left the real edit before it in place.
   *
   * `withoutStamp` discounting `createdAt` fixes what Undo SEES. This asserts
   * the cause: the edge is not rewritten in the first place. The two need
   * separate tests because with the stamp discounted, the wholesale version
   * looks identical from `changesNothing` — it was still writing every edge.
   */
  it('does not spend an undo slot on a save that changed nothing', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Scientist',
        roleTag: 'Research Scientist',
        stage: 'draft',
      }),
    )
    const [file] = okOr(
      h.runtime.run('vault.file.add', {
        files: [{ name: 'CV.pdf', kind: 'pdf', bucket: 'To read', size: '1 KB', applicationIds: [app] }],
      }),
    )
    const undoBefore = h.repo.undoable.length

    // The same filing, written again — what pressing Save on an untouched form does.
    okOr(h.runtime.run('vault.file.update', { id: file!, applicationIds: [app] }))

    // Measured against the code before the fix, this was 3: the no-op save took
    // the top of the undo ring, so the next Ctrl+Z undid a timestamp and left
    // the real edit before it in place.
    expect(h.repo.undoable.length).toBe(undoBefore)
    expect(h.repo.getSnapshot().out(file!, 'FILED_UNDER')).toHaveLength(1)
  })

  it('still unfiles what the save removed', () => {
    // Differential must not mean inert: an application dropped from the list
    // has to lose its edge.
    const h = harness()
    const mk = (org: string, role: string) =>
      okOr(h.runtime.run('application.create', { org, role, roleTag: 'Research Scientist', stage: 'draft' }))
    const one = mk('Rice', 'A')
    const two = mk('Baylor', 'B')
    const [file] = okOr(
      h.runtime.run('vault.file.add', {
        files: [{ name: 'CV.pdf', kind: 'pdf', bucket: 'To read', size: '1 KB', applicationIds: [one, two] }],
      }),
    )
    okOr(h.runtime.run('vault.file.update', { id: file!, applicationIds: [two] }))

    const after = h.repo.getSnapshot().out(file!, 'FILED_UNDER')
    expect(after.map((e) => e.to)).toEqual([two])
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

  /**
   * `touch` stamps `lastActionAt`, and nothing asserted that it moves.
   *
   * Deleting `lastActionAt` from the patch in `touch` — leaving `lastAction`,
   * so the sentence still changes and every existing assertion still passes —
   * was green on all 474 tests. The field is not cosmetic: `daysAgo` is
   * projected from it and from nothing else (`react/projections.ts`), and that
   * is the "3 days ago" on the phone's Today screen, the "Last activity"
   * column, and the DEFAULT SORT of the applications list on both platforms.
   * D25 moved the field into storage precisely so it would stop lying after a
   * reload; a silent stop here sinks the row the user just touched to the
   * bottom of two screens, which is the exact bug `touch`'s own header says it
   * was written to fix.
   *
   * Every tool that calls `touch` is exercised, not one of them, because the
   * mutation is in the shared helper and a single call site would leave the
   * other four unpinned.
   */
  it('moves lastActionAt on every tool that touches an application', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Baylor',
        role: 'CS',
        roleTag: 'Assistant Professor',
        stage: 'submitted',
      }),
    )

    const stampOf = () => {
      const props = h.repo.getSnapshot().node(app, 'application')?.props
      if (!props) throw new Error('the application went missing')
      return { at: props.lastActionAt, action: props.lastAction }
    }

    // `application.create` stamps the field directly rather than through
    // `touch`, so this is the baseline the five below have to beat.
    let previous = stampOf()
    expect(previous.at).toBe(new Date(START).toISOString())

    const run = (name: keyof typeof TOOLS, input: Record<string, unknown>) => {
      const result = h.runtime.run(name, input as never)
      if (!result.ok) throw new Error(`${name}: ${result.errors.map((e) => e.message).join('; ')}`)
    }

    /** Runs a tool that calls `touch` and asserts both halves of the stamp. */
    const touches = (name: keyof typeof TOOLS, input: Record<string, unknown>, action: string) => {
      run(name, input)
      const now = stampOf()
      expect(now.action, `${name} did not record what it did`).toBe(action)
      // Strictly later, not merely present: the harness clock advances a second
      // per read, so a patch that dropped the field would leave the ORIGINAL
      // stamp in place and still satisfy a truthiness check.
      expect(now.at > previous.at, `${name} left lastActionAt at ${previous.at}`).toBe(true)
      previous = now
    }

    touches('application.stage.advance', { id: app, stage: 'screen' }, 'Moved to Screening call')
    touches('application.stage.set', { id: app, stage: 'offer' }, 'Moved to Offer')
    touches('application.note.set', { id: app, note: 'Negotiating' }, 'Note edited')

    // `application.offer.decide` refuses when there is nothing to decide on,
    // and `application.update` stamps the field itself, so the baseline is
    // re-read rather than assumed across the setup write.
    run('application.update', {
      id: app,
      offer: { respondBy: '2026-11-15', comp: '$112k', note: 'Negotiating.' },
    })
    previous = stampOf()

    touches('application.offer.decide', { id: app, outcome: 'accepted' }, 'Offer accepted')
    touches('application.offer.clear', { id: app }, 'Offer details cleared')
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
        applicationIds: [app],
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
    // The FIRST seeded match is the UNT one, and the fixtures already link it to
    // the UNT application. This used to take it anyway — `BECAME` is
    // `fromCardinality: 'one'`, so the promote quietly minted a second UNT draft
    // and moved the edge onto it, and the assertions below passed on the
    // duplicate. `scout.match.promote` refuses that now, so the test has to name
    // a match nobody has promoted yet — which is what it always meant.
    const snapshot = h.repo.getSnapshot()
    const match = snapshot.ofType('match').find((n) => !snapshot.one(n.id, 'BECAME', 'application'))
    if (!match) throw new Error('the seed has no unpromoted matches')

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

  /**
   * What the person has actually done, as opposed to what they say they want.
   *
   * The profile has always held the second — ten text fields, typed. These hold
   * the first, and they exist because a CV could be uploaded, converted to text
   * and read, and nothing ever looked at what came back: somebody with forty
   * pages of evidence in the Vault scored exactly like somebody with none.
   */
  it('records several background facts in one call', () => {
    /*
     * Bulk, and the array is the point rather than a convenience. A CV yields
     * thirty facts; one call each is thirty round trips, thirty approval
     * prompts and thirty journal rows for something the person did once — and
     * with the agent's step cap at eight it runs out of rounds before it
     * reaches the publications.
     */
    const h = harness()
    const ids = okOr(
      h.runtime.run('profile.background.add', {
        background: [
          { kind: 'education', title: 'PhD, Computer Science', where: 'Illinois', year: 2021 },
          { kind: 'publication', title: 'Consistent snapshots', where: 'OSDI', year: 2023 },
          { kind: 'skill', title: 'Rust' },
        ],
      }),
    ) as string[]

    expect(ids).toHaveLength(3)
    const m = h.repo.getSnapshot()
    expect(m.ofType('background')).toHaveLength(3)
    expect(m.ofType('background').map((n) => n.props.kind).sort()).toEqual([
      'education',
      'publication',
      'skill',
    ])
  })

  it('keeps the period as written rather than inventing a date', () => {
    // A CV says "2021–2024", "Summer 2019" and "since 2024". Forcing those into
    // ISO means refusing most of them or inventing precision nobody wrote down.
    const h = harness()
    okOr(
      h.runtime.run('profile.background.add', {
        background: [{ kind: 'employment', title: 'Postdoc', period: 'Summer 2019 – present' }],
      }),
    )
    expect(h.repo.getSnapshot().ofType('background')[0]?.props.period).toBe(
      'Summer 2019 – present',
    )
  })

  it('corrects one fact without touching the rest', () => {
    const h = harness()
    const ids = okOr(
      h.runtime.run('profile.background.add', {
        background: [
          { kind: 'skill', title: 'Rust' },
          { kind: 'skill', title: 'Go' },
        ],
      }),
    ) as string[]

    okOr(h.runtime.run('profile.background.update', { id: ids[0]!, title: 'Rust (async)' }))
    const m = h.repo.getSnapshot()
    expect(m.node(ids[0]!, 'background')?.props.title).toBe('Rust (async)')
    expect(m.node(ids[1]!, 'background')?.props.title).toBe('Go')
  })

  it('removes one that was read wrongly, and the removal can be taken back', () => {
    /*
     * Undo matters more here than for most deletes. These records are written
     * by a model reading somebody's own CV, so a wrong one is jojo's mistake
     * rather than theirs — and the fix has to be as cheap as the error.
     */
    const h = harness()
    const ids = okOr(
      h.runtime.run('profile.background.add', {
        background: [{ kind: 'award', title: 'A prize that was misread' }],
      }),
    ) as string[]

    okOr(h.runtime.run('profile.background.delete', { id: ids[0]! }))
    expect(h.repo.getSnapshot().ofType('background')).toHaveLength(0)

    h.runtime.undo()
    expect(h.repo.getSnapshot().ofType('background')).toHaveLength(1)
  })

  it('refuses a kind jojo does not have, rather than filing it as text', () => {
    /*
     * Cast, because TypeScript rejects 'hobby' outright — which is the stronger
     * guarantee and covers every caller in this repo. It does not cover the one
     * caller that matters here: a model, whose arguments arrive as JSON off a
     * socket and are typechecked by nothing. This exercises that path.
     */
    const h = harness()
    const out = h.runtime.run('profile.background.add', {
      background: [{ kind: 'hobby' as 'skill', title: 'Cycling' }],
    })
    expect(out.ok).toBe(false)
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

  /**
   * A delete names the record it removed, and every delete names a DIFFERENT one.
   *
   * `describe` runs after `execute`, and on the plain overlay `m.node(id)`
   * answers `undefined` for anything `tx.del` staged — so all thirteen delete
   * tools took the fallback inside their own `describe` and announced
   * themselves by TYPE. Two keywords cleared in a row wrote two audit rows both
   * reading *"Keyword deleted"*, and an Undo menu offering to put one of them
   * back without saying which.
   *
   * Asserted on the journal label as well as the toast, because those are the
   * two places the string lands and only one of them is on screen long enough
   * to notice it is wrong. The application is in here on purpose: `displayOf`
   * walks AT to the employer, so naming it needs the EDGE `tx.del` dropped and
   * not only the node — with the node alone put back this reads
   * *" — Statistics deleted"*, a dangling separator where Rice should be.
   */
  it('names the record a delete removed, from before the delete', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Statistics',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    )
    const referral = okOr(h.runtime.run('keyword.create', { name: 'Referral' }))
    const cohort = okOr(h.runtime.run('keyword.create', { name: 'Cohort' }))

    const said = (
      result:
        | { ok: true; announcement: { title: string } }
        | { ok: false; errors: readonly { message: string }[] },
    ) => {
      if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
      return result.announcement
    }

    expect(said(h.runtime.run('keyword.delete', { id: referral })).title).toBe('Referral deleted')
    expect(said(h.runtime.run('keyword.delete', { id: cohort })).title).toBe('Cohort deleted')
    expect(said(h.runtime.run('application.delete', { id: app })).title).toBe(
      'Rice — Statistics deleted',
    )

    // The journal label is that same string, and the three newest rows are
    // three different sentences rather than one repeated.
    expect(h.repo.undoable.slice(0, 3).map((e) => e.label)).toEqual([
      'Rice — Statistics deleted',
      'Cohort deleted',
      'Referral deleted',
    ])
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

/* -------------------------------------------------------------------------- */

/**
 * The queue between an agent's intention and the graph.
 *
 * The claim under test is not that a proposal can be stored — it is that
 * approving one is indistinguishable, to the journal and to undo, from the user
 * having pressed the button themselves. That is what makes a queued suggestion
 * safe to accept: it buys the agent no path the user did not already have.
 */
describe('the proposal queue', () => {
  const aPipeline = (h: ReturnType<typeof harness>, kind: 'twin' | 'scout' = 'twin') =>
    okOr(
      h.runtime.run('scout.pipeline.create', {
        name: 'Tidy the graph',
        source: '—',
        schedule: 'daily',
        filter: '—',
        kind,
      }),
    )

  const anApplication = (h: ReturnType<typeof harness>) =>
    okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Assistant professor',
        roleTag: 'Assistant Professor',
        stage: 'draft',
      }),
    )

  it('files a raised proposal against the pipeline that raised it', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)

    const id = okOr(
      h.runtime.run('pipeline.proposal.raise', {
        pipelineId: pipeline,
        kind: 'twin',
        tool: 'application.note.set',
        input: JSON.stringify({ id: app, note: 'Deadline is a Friday.' }),
        title: 'Note the deadline falls on a Friday',
        rationale: 'The deadline is 2026-11-06 and nothing records that it is a weekend.',
      }),
    )

    const m = h.repo.getSnapshot()
    const proposal = m.node(id, 'proposal')
    expect(proposal?.props.status).toBe('pending')
    expect(proposal?.props.tool).toBe('application.note.set')
    expect(m.out(id, 'FROM').map((e) => e.to)).toEqual([pipeline])
  })

  it('refuses a tool the pipeline’s kind is not allowed to use', () => {
    const h = harness()
    const pipeline = aPipeline(h, 'scout')
    const app = anApplication(h)

    const result = h.runtime.run('pipeline.proposal.raise', {
      pipelineId: pipeline,
      kind: 'scout',
      tool: 'application.note.set',
      input: JSON.stringify({ id: app, note: 'x' }),
      title: 'Write a note',
      rationale: 'because',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]?.message).toContain('may not use')
  })

  it('refuses arguments that are not JSON at all', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const result = h.runtime.run('pipeline.proposal.raise', {
      pipelineId: pipeline,
      kind: 'twin',
      tool: 'application.note.set',
      input: 'not json',
      title: 'Write a note',
      rationale: 'because',
    })
    expect(result.ok).toBe(false)
  })

  /*
   * The central one. Approving runs the proposed tool for real, and the whole
   * thing — the note AND the fact that it was approved — is one journal row, so
   * one Undo puts the graph back exactly as it was.
   */
  it('applies the proposed tool in ONE commit that undo reverses completely', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)
    const id = okOr(
      h.runtime.run('pipeline.proposal.raise', {
        pipelineId: pipeline,
        kind: 'twin',
        tool: 'application.note.set',
        input: JSON.stringify({ id: app, note: 'Deadline is a Friday.' }),
        title: 'Note the deadline',
        rationale: 'because',
      }),
    )

    const before = graphOf(h.repo)
    const journalBefore = h.repo.audit.length

    okOr(h.runtime.run('pipeline.proposal.approve', { id }))

    const after = h.repo.getSnapshot()
    expect(after.node(app, 'application')?.props.note).toBe('Deadline is a Friday.')
    expect(after.node(id, 'proposal')?.props.status).toBe('approved')
    expect(after.node(id, 'proposal')?.props.decidedAt).toBeTruthy()
    expect(h.repo.audit.length - journalBefore).toBe(1)

    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  it('will not answer the same proposal twice', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)
    const id = okOr(
      h.runtime.run('pipeline.proposal.raise', {
        pipelineId: pipeline,
        kind: 'twin',
        tool: 'application.note.set',
        input: JSON.stringify({ id: app, note: 'x' }),
        title: 'Note',
        rationale: 'because',
      }),
    )
    okOr(h.runtime.run('pipeline.proposal.approve', { id }))

    const again = h.runtime.run('pipeline.proposal.approve', { id })
    expect(again.ok).toBe(false)
    const discard = h.runtime.run('pipeline.proposal.discard', { id })
    expect(discard.ok).toBe(false)
  })

  /*
   * A proposal outlives the record it names. Approving one whose target has
   * been deleted must fail cleanly and change nothing — including not marking
   * itself approved, which is what makes the rollback observable.
   */
  it('rolls back entirely when the proposed tool refuses', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)
    const id = okOr(
      h.runtime.run('pipeline.proposal.raise', {
        pipelineId: pipeline,
        kind: 'twin',
        tool: 'application.note.set',
        input: JSON.stringify({ id: app, note: 'x' }),
        title: 'Note',
        rationale: 'because',
      }),
    )
    okOr(h.runtime.run('application.delete', { id: app }))

    const before = graphOf(h.repo)
    const result = h.runtime.run('pipeline.proposal.approve', { id })

    expect(result.ok).toBe(false)
    expect(graphOf(h.repo)).toEqual(before)
    expect(h.repo.getSnapshot().node(id, 'proposal')?.props.status).toBe('pending')
  })

  it('records why an approval could not be carried out', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)
    const id = okOr(
      h.runtime.run('pipeline.proposal.raise', {
        pipelineId: pipeline,
        kind: 'twin',
        tool: 'application.note.set',
        input: JSON.stringify({ id: app, note: 'x' }),
        title: 'Note',
        rationale: 'because',
      }),
    )
    okOr(h.runtime.run('pipeline.proposal.fail', { id, error: 'That record is no longer here.' }))

    const proposal = h.repo.getSnapshot().node(id, 'proposal')
    expect(proposal?.props.status).toBe('failed')
    expect(proposal?.props.error).toBe('That record is no longer here.')
  })

  it('discards without touching anything else', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)
    const id = okOr(
      h.runtime.run('pipeline.proposal.raise', {
        pipelineId: pipeline,
        kind: 'twin',
        tool: 'application.note.set',
        input: JSON.stringify({ id: app, note: 'unwanted' }),
        title: 'Note',
        rationale: 'because',
      }),
    )
    okOr(h.runtime.run('pipeline.proposal.discard', { id }))

    const m = h.repo.getSnapshot()
    expect(m.node(id, 'proposal')?.props.status).toBe('discarded')
    // `application.create` writes an empty note rather than omitting the key, so
    // "untouched" is the empty string here, not `undefined`.
    expect(m.node(app, 'application')?.props.note).toBe('')
  })

  it('sweeps answered suggestions and leaves the waiting ones', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const app = anApplication(h)
    const raise = (note: string) =>
      okOr(
        h.runtime.run('pipeline.proposal.raise', {
          pipelineId: pipeline,
          kind: 'twin',
          tool: 'application.note.set',
          input: JSON.stringify({ id: app, note }),
          title: `Note ${note}`,
          rationale: 'because',
        }),
      )
    const answered = raise('a')
    const waiting = raise('b')
    okOr(h.runtime.run('pipeline.proposal.discard', { id: answered }))

    expect(okOr(h.runtime.run('pipeline.proposal.sweep', { pipelineId: pipeline }))).toBe(1)
    const m = h.repo.getSnapshot()
    expect(m.node(answered, 'proposal')).toBeUndefined()
    expect(m.node(waiting, 'proposal')?.props.status).toBe('pending')
  })

  it('counts consecutive empty rounds and forgets them on a productive one', () => {
    const h = harness()
    const pipeline = aPipeline(h)
    const idle = () => h.repo.getSnapshot().node(pipeline, 'pipeline')?.props.idleRounds

    okOr(h.runtime.run('pipeline.run.record', { id: pipeline, raised: 0 }))
    expect(idle()).toBe(1)
    okOr(h.runtime.run('pipeline.run.record', { id: pipeline, raised: 0 }))
    expect(idle()).toBe(2)
    okOr(h.runtime.run('pipeline.run.record', { id: pipeline, raised: 3 }))
    expect(idle()).toBe(0)
    expect(h.repo.getSnapshot().node(pipeline, 'pipeline')?.props.lastRunAt).toBeTruthy()
  })

  it('refuses to put a scout pipeline into auto mode', () => {
    const h = harness()
    const pipeline = aPipeline(h, 'scout')
    const result = h.runtime.run('scout.pipeline.update', { id: pipeline, auto: true })
    expect(result.ok).toBe(false)
    expect(okOr(h.runtime.run('scout.pipeline.update', { id: aPipeline(h), auto: true }))).toBe(
      undefined,
    )
  })

  /*
   * The check `core/proposal.ts` cannot make for itself: it may not import the
   * registry, so an allowlist could name a tool that does not exist and every
   * test over there would still pass while every proposal failed at approval.
   */
  it('names only tools that actually exist', () => {
    for (const tool of [...TWIN_TOOLS, ...SCOUT_TOOLS]) {
      expect(Object.keys(TOOLS)).toContain(tool)
    }
  })
})

describe('switching a pipeline back on', () => {
  /*
   * Found by running the real page. A pipeline that had gone idle kept its
   * counter across an off/on cycle, so `isDue` stayed on the schedule and a
   * daily pipeline the user had just switched on sat for a day doing what it
   * did while off. Flicking the switch is the clearest statement there is that
   * they want it to look again.
   */
  it('clears the idle counter, so it starts looking rather than sleeping', () => {
    const h = harness()
    const id = okOr(
      h.runtime.run('scout.pipeline.create', {
        name: 'Tidy',
        source: '—',
        schedule: 'daily',
        filter: '—',
        kind: 'twin',
      }),
    )
    okOr(h.runtime.run('pipeline.run.record', { id, raised: 0 }))
    okOr(h.runtime.run('pipeline.run.record', { id, raised: 0 }))
    expect(h.repo.getSnapshot().node(id, 'pipeline')?.props.idleRounds).toBe(2)

    okOr(h.runtime.run('scout.pipeline.enable.set', { id, enabled: false }))
    okOr(h.runtime.run('scout.pipeline.enable.set', { id, enabled: true }))

    const p = h.repo.getSnapshot().node(id, 'pipeline')
    expect(p?.props.enabled).toBe(true)
    expect(p?.props.idleRounds).toBe(0)
    // The record of what happened is not un-happened by switching it on.
    expect(p?.props.lastRunAt).toBeTruthy()
  })

  it('leaves the counter alone when switching one off', () => {
    const h = harness()
    const id = okOr(
      h.runtime.run('scout.pipeline.create', {
        name: 'Tidy',
        source: '—',
        schedule: 'daily',
        filter: '—',
        kind: 'twin',
      }),
    )
    okOr(h.runtime.run('pipeline.run.record', { id, raised: 0 }))
    okOr(h.runtime.run('scout.pipeline.enable.set', { id, enabled: false }))
    expect(h.repo.getSnapshot().node(id, 'pipeline')?.props.idleRounds).toBe(1)
  })
})

describe('acting without asking', () => {
  /*
   * A conversation-level permission. The tool only records it — the gate is in
   * the agent loop, at the point of use — which is the same division
   * `PipelineProps.auto` makes and for the same reason: a tool that tried to
   * enforce a policy would still be one commit away from a graph that
   * disagreed with it.
   */
  it('remembers how much one conversation may do without being asked', () => {
    const h = harness()
    const id = okOr(h.runtime.run('assistant.thread.create', { title: 'Tidy up' }))
    // Absent, not `manual`: a new conversation stores nothing and `approvalOf`
    // reads the safe default, so the record says what a person CHOSE.
    expect(h.repo.getSnapshot().node(id, 'thread')?.props.approval).toBeUndefined()

    for (const mode of APPROVAL_MODES) {
      okOr(h.runtime.run('assistant.thread.auto.set', { id, mode }))
      expect(h.repo.getSnapshot().node(id, 'thread')?.props.approval).toBe(mode)
    }
  })

  it('clears the old boolean, so two fields cannot disagree', () => {
    /*
     * A conversation written by an older build carries `autoApprove` and no
     * `approval`. Setting a mode must not leave both behind: `approvalOf`
     * prefers `approval`, so a stale boolean is invisible until something reads
     * it directly — which is how "it asked me even though I turned that off"
     * gets reported months later.
     */
    // Seeded into the snapshot directly, because no tool writes `autoApprove`
    // any more — this is a record an OLDER BUILD left behind.
    const legacy = 'thread:0198e2a0-0000-7000-8000-00000000beef' as NodeId
    const snapshot = new MutableSnapshot()
    snapshot.putNode({
      id: legacy,
      type: 'thread',
      props: { slug: 'tidy-up', title: 'Tidy up', entries: [], autoApprove: true },
      createdAt: new Date(START).toISOString(),
      updatedAt: new Date(START).toISOString(),
    })
    const h = harness(snapshot)

    expect(approvalOf(h.repo.getSnapshot().node(legacy, 'thread')!.props)).toBe('semi')

    okOr(h.runtime.run('assistant.thread.auto.set', { id: legacy, mode: 'manual' }))
    const props = h.repo.getSnapshot().node(legacy, 'thread')?.props
    expect(props?.approval).toBe('manual')
    expect(props?.autoApprove).toBeUndefined()
  })

  it('reads a conversation written before modes existed', () => {
    // The two old settings map onto the first two modes, and nobody is
    // silently upgraded to `auto` — that is a mode a person has to choose.
    expect(approvalOf({ autoApprove: true })).toBe('semi')
    expect(approvalOf({ autoApprove: false })).toBe('manual')
    expect(approvalOf({})).toBe('manual')
    // An explicit mode always wins over the legacy field.
    expect(approvalOf({ approval: 'auto', autoApprove: false })).toBe('auto')
  })

  it('is undoable, because granting it is a decision worth taking back', () => {
    const h = harness()
    const id = okOr(h.runtime.run('assistant.thread.create', { title: 'Tidy up' }))
    const before = graphOf(h.repo)
    okOr(h.runtime.run('assistant.thread.auto.set', { id, mode: 'auto' }))
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  /**
   * The summary a long conversation carries once it outgrows the model.
   *
   * Kept on the thread rather than recomputed each turn, which is the whole
   * difference between a chat that runs long and one that pays a summarisation
   * call per turn once it gets big. `contextThrough` is what stops the next
   * compaction summarising the same exchanges again — a summary of a summary,
   * blurring what the last pass already blurred.
   */
  it('remembers what a compacted conversation established', () => {
    const h = harness()
    const id = okOr(h.runtime.run('assistant.thread.create', { title: 'Long one' }))
    expect(h.repo.getSnapshot().node(id, 'thread')?.props.context).toBeUndefined()
    expect(h.repo.getSnapshot().node(id, 'thread')?.props.contextThrough).toBeUndefined()

    okOr(
      h.runtime.run('assistant.thread.context.set', {
        id,
        context: 'They chose the Rice assistant professor role and filed the CV under it.',
        through: 12,
      }),
    )
    const props = h.repo.getSnapshot().node(id, 'thread')?.props
    expect(props?.context).toContain('assistant professor')
    // Where the summary reaches, so the next compaction starts after it.
    expect(props?.contextThrough).toBe(12)
  })

  it('replaces the summary rather than appending to it', () => {
    // A compaction summarises everything up to a new point, so the second one
    // supersedes the first. Appending would grow the thing that exists to stop
    // the conversation growing.
    const h = harness()
    const id = okOr(h.runtime.run('assistant.thread.create', { title: 'Long one' }))
    okOr(h.runtime.run('assistant.thread.context.set', { id, context: 'first', through: 4 }))
    okOr(h.runtime.run('assistant.thread.context.set', { id, context: 'second', through: 20 }))
    const props = h.repo.getSnapshot().node(id, 'thread')?.props
    expect(props?.context).toBe('second')
    expect(props?.contextThrough).toBe(20)
  })

  it('takes the summary back with an undo, like every other write', () => {
    const h = harness()
    const id = okOr(h.runtime.run('assistant.thread.create', { title: 'Long one' }))
    const before = graphOf(h.repo)
    okOr(h.runtime.run('assistant.thread.context.set', { id, context: 'x', through: 2 }))
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)
  })

  it('leaves every other conversation asking', () => {
    const h = harness()
    const one = okOr(h.runtime.run('assistant.thread.create', { title: 'One' }))
    const two = okOr(h.runtime.run('assistant.thread.create', { title: 'Two' }))
    okOr(h.runtime.run('assistant.thread.auto.set', { id: one, mode: 'auto' }))
    expect(h.repo.getSnapshot().node(two, 'thread')?.props.approval).toBeUndefined()
  })
})

/**
 * "Blanks the profile" has to mean the whole profile.
 *
 * `memory.clear` patched `text` and `matchTerms` and left `roles`,
 * `includeAcademia` and `includeIndustry` standing — so a store the person had
 * just emptied still knew which role tags they were targeting and which halves
 * of the job market they had switched off.
 *
 * This is the one tool in the app somebody reaches for when they want their
 * data gone. It is `undoable: false` and its summary says "Removes every record
 * and blanks the profile". Leaving preferences behind is the shape of privacy
 * bug that gets found by the person it happened to.
 */
describe('emptying the store', () => {
  it('leaves nothing personal in the profile', () => {
    const h = harness()
    okOr(
      h.runtime.run('profile.text.set', { field: 'fullName', value: 'Dr A. Person' }),
    )
    okOr(h.runtime.run('profile.matchTerm.add', { term: 'distributed systems' }))
    okOr(h.runtime.run('profile.preference.set', { key: 'includeIndustry', value: false }))

    okOr(h.runtime.run('memory.clear', { confirm: true }))

    const profile = h.repo.getSnapshot().ofType('profile')[0]
    expect(profile).toBeDefined()
    const props = profile!.props as {
      text: Record<string, string>
      matchTerms: string[]
      roles: string[]
      includeAcademia: boolean
      includeIndustry: boolean
    }

    // Nothing the person typed.
    expect(Object.values(props.text).every((v) => v === '')).toBe(true)
    expect(props.matchTerms).toEqual([])
    // And nothing they CHOSE. This is the half that survived.
    expect(props.includeIndustry).toBe(true)
    expect(props.includeAcademia).toBe(true)
    expect(props.roles).toEqual([...DEFAULT_ROLES])
  })

  it('leaves a usable profile, not an empty one', () => {
    /*
     * Reset to a FRESH profile rather than to nothing: a profile with no roles
     * and both scout switches off is not blank, it is broken — the scout would
     * silently match nothing and the person would never know why.
     */
    const h = harness()
    okOr(h.runtime.run('memory.clear', { confirm: true }))
    const props = h.repo.getSnapshot().ofType('profile')[0]!.props as { roles: string[] }
    expect(props.roles.length).toBeGreaterThan(0)
  })
})

/**
 * A destructive tool's announcement has to name what it is about to destroy.
 *
 * `describe` builds the approval card AND the journal label. `proposalDetail`
 * deliberately skips ids, so a card reading "Conversation deleted" over a list
 * of six is not a decision anybody can make — and an audit log of identical
 * anonymous rows cannot answer "a record changed by itself", which is the
 * question it exists for.
 *
 * Only the destructive ones are required to. A singleton like `memory.clear`
 * or `profile.set` has no record to name, and inventing one would be noise.
 */
describe('what a destructive announcement says', () => {
  it('names the record', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', {
        org: 'Rice',
        role: 'Scientist',
        roleTag: 'Research Scientist',
        stage: 'draft',
      }),
    )
    const thread = okOr(h.runtime.run('assistant.thread.create', { title: 'Tidy up' }))

    // A delete whose card says only "Conversation deleted" is a card nobody can
    // act on. `application.delete` was already named; this pins the pair.
    void app

    // The announcement for the delete carries the record's name.
    const before = h.repo.getSnapshot()
    const shown = TOOLS['assistant.thread.delete'].describe({ id: thread } as never, undefined as never, before)
    expect(`${shown.title} ${shown.description ?? ''}`).toContain('Tidy up')
  })
})
