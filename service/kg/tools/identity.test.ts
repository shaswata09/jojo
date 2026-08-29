/**
 * Two identity invariants that no single tool owns, and that both broke when a
 * decision one layer away changed underneath them.
 *
 * WHICH timeline item is an application's own deadline. `support.ts` answers it
 * from `kind` and a detail sentinel, and that was the whole space while `ABOUT`
 * was `fromCardinality: 'one'`. It is `'many'` now, so an item can be about
 * three applications at once and still match.
 *
 * WHAT makes a slug free. `runtime.ts` answers it from the live graph, and a
 * deleted record leaves the live graph while staying revertable for the length
 * of the undo window — with the delete toast holding a `revert` handle on that
 * exact entry.
 *
 * Both are asserted here rather than in `tools.test.ts` because neither is a
 * claim about one tool: the first is read by the application form and written by
 * the timeline tools, and the second is a property of every tool that mints a
 * slug, checked against undo rather than against a tool.
 *
 * Clock injected and fixed, as everywhere in this suite (D26).
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'
import { applicationDeadlineOf } from './support'

type Options = Parameters<typeof createRepository>[0]

/** Accepts everything, remembers nothing. Durability is not what this asserts. */
const nullDriver = (): Options['driver'] => ({
  open: async () => ({ ok: true, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true, value: undefined }),
  replace: async () => ({ ok: true, value: undefined }),
  seedIfPristine: async () => ({ ok: true, value: true }),
  destroy: async () => ({ ok: true, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

const START = Date.parse('2026-10-12T15:00:00.000Z')

function harness() {
  // A second per read, so ids stay ordered the way `ofType` depends on.
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
  const repo = createRepository({ driver: nullDriver(), snapshot: new MutableSnapshot(), meta, now })
  return { repo, runtime: createToolRuntime({ repo, now }) }
}

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}

const draft = (org: string, role: string) =>
  ({ org, role, roleTag: 'Assistant Professor', stage: 'draft' }) as const

/* --------------------- which item is THE deadline ------------------------- */

describe("the application form's own deadline", () => {
  it('is never a reference deadline shared with another application', () => {
    const h = harness()
    const rice = okOr(h.runtime.run('application.create', draft('Rice', 'Statistics')))
    const unt = okOr(h.runtime.run('application.create', draft('UNT', 'CS')))

    // The case `ABOUT` was widened to `fromCardinality: 'many'` FOR: one dated
    // item covering two jobs. Its detail opens with the sentinel, because that
    // is what a person writing about application deadlines writes.
    const shared = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Reference letters',
        detail: 'Application deadline · references for both',
        date: '2026-09-30',
        kind: 'deadline',
        applicationIds: [rice, unt],
      }),
    )

    okOr(h.runtime.run('application.update', { id: rice, deadline: '2026-11-01' }))
    okOr(h.runtime.run('application.update', { id: unt, deadline: '2026-11-20' }))

    const m = h.repo.getSnapshot()
    // Each application owns its own date, and the shared item still says what
    // the user typed. Before this was fixed, `syncDeadline` adopted the shared
    // item twice: it ended on 2026-11-20, both applications reported that one
    // date, neither had a deadline of its own, and the user's reference item
    // was gone.
    expect(applicationDeadlineOf(m, rice)?.props.date).toBe('2026-11-01')
    expect(applicationDeadlineOf(m, unt)?.props.date).toBe('2026-11-20')
    expect(m.node(shared, 'timelineItem')?.props.date).toBe('2026-09-30')
  })

  it('does not change when undo re-inserts its ABOUT edge behind another item', () => {
    const h = harness()
    const app = okOr(
      h.runtime.run('application.create', { ...draft('Rice', 'Statistics'), deadline: '2026-11-01' }),
    )
    const own = h.repo.getSnapshot().many(app, 'ABOUT', 'in', 'timelineItem')[0]
    if (!own) throw new Error('the form minted no deadline')

    // The user's own dated note, filed under the same application, whose detail
    // happens to open with the sentinel too.
    okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Chase referee',
        detail: 'Application deadline · chase the letter',
        date: '2026-10-01',
        kind: 'deadline',
        applicationIds: [app],
      }),
    )

    // Delete and undo, which re-inserts the form's ABOUT edge at the END of the
    // index. `many` yields edge-insertion order, so a plain `find` then answered
    // with 'Chase referee' and the application reported 2026-10-01 from then on.
    okOr(h.runtime.run('timeline.item.delete', { id: own.id }))
    h.runtime.undo()

    const m = h.repo.getSnapshot()
    expect(m.many(app, 'ABOUT', 'in', 'timelineItem').map((i) => i.props.title)).toEqual([
      'Chase referee',
      'Rice — Statistics',
    ])
    expect(applicationDeadlineOf(m, app)?.id).toBe(own.id)
    expect(applicationDeadlineOf(m, app)?.props.date).toBe('2026-11-01')
  })
})

/* --------------------------- what a slug is free of ----------------------- */

describe('minting a slug', () => {
  it('does not re-use one a revertable delete can still put back', () => {
    const h = harness()
    const first = okOr(h.runtime.run('application.create', draft('Rice', 'Statistics')))
    expect(h.repo.getSnapshot().node(first, 'application')?.props.slug).toBe('rice')

    // The delete's toast holds this handle for as long as it is on screen.
    const deleted = h.runtime.run('application.delete', { id: first })
    if (!deleted.ok) throw new Error(deleted.errors.map((e) => e.message).join('; '))

    const second = okOr(h.runtime.run('application.create', draft('Rice', 'Mathematics')))
    // 'rice' is free in the live graph and NOT free in the session: the undo
    // ring is still holding the record that had it.
    expect(h.repo.getSnapshot().node(second, 'application')?.props.slug).toBe('rice-2')

    deleted.undo?.()

    const m = h.repo.getSnapshot()
    const slugs = m.ofType('application').map((n) => n.props.slug)
    expect([...slugs].sort()).toEqual(['rice', 'rice-2'])
    // The point of the invariant: both records are still reachable by URL.
    // With one slug between them, `/applications/rice` opened the restored
    // record and the one just created had no address at all.
    expect(m.bySlug('application', 'rice')?.id).toBe(first)
    expect(m.bySlug('application', 'rice-2')?.id).toBe(second)
  })

  it('does not reserve against a redo this very commit destroys', () => {
    const h = harness()
    const first = okOr(h.runtime.run('application.create', draft('Rice', 'Statistics')))
    expect(h.repo.getSnapshot().node(first, 'application')?.props.slug).toBe('rice')

    // Undo the CREATE. The record is gone and its entry is now redoable — but
    // `repo.commit` clears redo for any entry that changes something, so the
    // next create destroys that future rather than competing with it. Holding
    // 'rice' back here would cost every user a 'rice-2' for a redo that can
    // never happen.
    h.runtime.undo()
    expect(h.repo.getSnapshot().ofType('application')).toHaveLength(0)

    const second = okOr(h.runtime.run('application.create', draft('Rice', 'Mathematics')))
    expect(h.repo.getSnapshot().node(second, 'application')?.props.slug).toBe('rice')
    expect(h.repo.redoable).toHaveLength(0)
  })
})
