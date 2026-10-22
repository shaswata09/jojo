/**
 * Questions about the values on records, over a graph built by the real tools.
 *
 * Built with the write tools for the reason `queries.test.ts` gives: a deadline
 * is a timeline item joined by `ABOUT` the way `application.create` and
 * `timeline.item.create` really join it, and a hand-built edge in the wrong
 * direction would test a graph the app never writes.
 */
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import { READS } from './queries'
import { fieldOf, resolveValue, test as passes } from './record-query'
import type { NodeId, TimelineKind } from '../core/model'
import type { GraphSnapshot } from '../core/snapshot'

const START = Date.parse('2026-10-01T09:00:00.000Z')
const TODAY = '2026-10-22'

const nullDriver = () => ({
  open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
  readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
  commit: async () => ({ ok: true as const, value: undefined }),
  replace: async () => ({ ok: true as const, value: undefined }),
  seedIfPristine: async () => ({ ok: true as const, value: true }),
  destroy: async () => ({ ok: true as const, value: undefined }),
  onRemoteCommit: () => () => {},
  onBlocking: () => () => {},
  close: () => {},
})

function harness() {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver() as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: {
      schemaVersion: 1,
      createdAt: new Date(START).toISOString(),
      lastOpenedAt: new Date(START).toISOString(),
      dataSet: 'empty',
      seededAt: null,
      handoverAt: null,
    },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  return { runtime, memory: () => repo.getSnapshot() as GraphSnapshot }
}

/**
 * Three applications shaped like the question that started this.
 *
 * Baylor carries an offer respond-by date further out than Rice's deadline —
 * the date Gemma mistook for a deadline — and UNT's real deadline is the
 * furthest of all. SMU has no deadline at all, so a sort that put missing
 * values first would answer "SMU".
 */
function store() {
  const h = harness()
  const app = (org: string, extra: Record<string, unknown> = {}) =>
    h.runtime.runOrThrow('application.create', {
      org,
      role: 'Assistant professor, CS',
      roleTag: 'Assistant Professor',
      stage: 'submitted',
      ...extra,
    }) as NodeId
  const item = (title: string, date: string, kind: TimelineKind, about: NodeId, extra: Record<string, unknown> = {}) =>
    h.runtime.runOrThrow('timeline.item.create', { title, date, kind, applicationIds: [about], ...extra }) as NodeId

  const rice = app('Rice', { submittedOn: '2026-09-01', firstReplyOn: '2026-09-21' })
  const unt = app('UNT', { submittedOn: '2026-09-10' })
  const baylor = app('Baylor', {
    stage: 'offer',
    submittedOn: '2026-08-20',
    firstReplyOn: '2026-08-30',
    offer: { respondBy: '2026-12-15', comp: '', note: '' },
  })
  const smu = app('SMU', { stage: 'closed', outcome: 'rejected' })

  item('Rice deadline', '2026-11-10', 'deadline', rice)
  item('UNT deadline', '2026-11-30', 'deadline', unt)
  // Already met, and in the past: neither is "the deadline" any more.
  item('UNT early round', '2026-10-01', 'deadline', unt, { completedOn: '2026-09-30' })
  item('Chase Rice', '2026-10-15', 'follow-up', rice)
  item('Rice interview', '2026-10-28', 'interview', rice)

  const keyword = h.runtime.runOrThrow('keyword.create', { name: 'Research', tone: 'teal' }) as NodeId
  h.runtime.runOrThrow('keyword.attach', { keyword, record: rice })
  h.runtime.runOrThrow('keyword.attach', { keyword, record: unt })

  return { memory: h.memory, rice, unt, baylor, smu, keyword }
}

const list = (memory: GraphSnapshot, input: Record<string, unknown>) =>
  READS['memory.list'].read(memory, input as never, { today: TODAY }) as Record<string, unknown>

type Listed = { total: number; shown: number; matches: Record<string, unknown>[] }

const employers = (out: Record<string, unknown>) =>
  (out as unknown as Listed).matches.map((m) => m['employer'])

describe('derived fields', () => {
  it('puts the deadline on the application, though it is stored on a timeline item', () => {
    const { memory, unt } = store()
    const out = list(memory(), { type: 'application' }) as unknown as Listed
    const record = out.matches.find((m) => m['id'] === unt)
    // The open deadline still ahead — not the early round already met.
    expect(record).toMatchObject({ employer: 'UNT', deadline: '2026-11-30', keywords: ['Research'] })
  })

  it('counts what is upcoming and what is overdue, and how long a reply took', () => {
    const { memory, rice } = store()
    const out = list(memory(), { type: 'application' }) as unknown as Listed
    expect(out.matches.find((m) => m['id'] === rice)).toMatchObject({
      upcoming: 2,
      overdue: 1,
      daysToReply: 20,
    })
  })

  it('never calls an offer respond-by a deadline', () => {
    // The date Gemma mistook for one. It stays where it is stored, `offer.respondBy`.
    const { memory, baylor } = store()
    const out = list(memory(), { type: 'application' }) as unknown as Listed
    const record = out.matches.find((m) => m['id'] === baylor)
    expect(record).toMatchObject({ offer: { respondBy: '2026-12-15' } })
    expect(record).not.toHaveProperty('deadline')
  })

  it('tells a timeline item which application it is about, and whether it is late', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'timelineItem', where: [{ field: 'overdue', op: 'eq', value: true }] })
    expect((out as unknown as Listed).matches).toEqual([
      expect.objectContaining({ title: 'Chase Rice', employer: 'Rice', done: false, daysAway: -7 }),
    ])
  })

  it('is shown by memory.get and memory.search too', () => {
    const { memory, unt } = store()
    const got = READS['memory.get'].read(memory(), { id: unt } as never, { today: TODAY }) as {
      record: Record<string, unknown>
    }
    expect(got.record['deadline']).toBe('2026-11-30')
  })
})

describe('memory.list as a query', () => {
  it('answers "which deadline is furthest away" in one call', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', orderBy: 'deadline', order: 'desc', limit: 1 })
    expect(employers(out)).toEqual(['UNT'])
    // The limit hides records, never that they exist.
    expect(out).toMatchObject({ total: 4, shown: 1 })
  })

  it('puts records without the field last in BOTH directions', () => {
    // Otherwise "the soonest deadline" ascending would be the application
    // with none, which is the opposite of an answer.
    const { memory } = store()
    expect(employers(list(memory(), { type: 'application', orderBy: 'deadline' }))).toEqual([
      'Rice',
      'UNT',
      expect.any(String),
      expect.any(String),
    ])
    const desc = employers(list(memory(), { type: 'application', orderBy: 'deadline', order: 'desc' }))
    expect(desc.slice(0, 2)).toEqual(['UNT', 'Rice'])
  })

  it('filters on dates relative to today', () => {
    const { memory } = store()
    const out = list(memory(), {
      type: 'application',
      where: [
        { field: 'deadline', op: 'gte', value: 'today' },
        { field: 'deadline', op: 'lte', value: 'today+25' },
      ],
    })
    expect(employers(out)).toEqual(['Rice'])
  })

  it('reads a nested field by its dotted path', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', where: [{ field: 'offer.respondBy', op: 'exists' }] })
    expect(employers(out)).toEqual(['Baylor'])
  })

  it('matches a list field by any element, without case', () => {
    const { memory } = store()
    const tagged = list(memory(), { type: 'application', where: [{ field: 'keywords', op: 'eq', value: 'research' }] })
    expect(employers(tagged).sort()).toEqual(['Rice', 'UNT'])
    const untagged = list(memory(), { type: 'application', where: [{ field: 'keywords', op: 'missing' }] })
    expect(employers(untagged).sort()).toEqual(['Baylor', 'SMU'])
  })

  it('takes "in" over a list of values', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', where: [{ field: 'stage', op: 'in', value: ['offer', 'closed'] }] })
    expect(employers(out).sort()).toEqual(['Baylor', 'SMU'])
  })

  it('counts per value with groupBy, biggest first', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', groupBy: 'stage' })
    expect(out['groups']).toEqual([
      { value: 'submitted', count: 2 },
      { value: 'closed', count: 1 },
      { value: 'offer', count: 1 },
    ])
  })

  it('groups a related field, and a list field by each element', () => {
    const { memory } = store()
    const items = list(memory(), { type: 'timelineItem', groupBy: 'employer' })
    expect(items['groups']).toEqual([
      { value: 'Rice', count: 3 },
      { value: 'UNT', count: 2 },
    ])
    // The untagged two are a group of their own, named null, and listed last.
    const tags = list(memory(), { type: 'application', groupBy: 'keywords' })
    expect(tags['groups']).toEqual([
      { value: 'Research', count: 2 },
      { value: null, count: 2 },
    ])
  })

  it('aggregates per group', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', groupBy: 'stage', aggregate: 'avg', of: 'daysToReply' })
    expect(out['groups']).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'submitted', count: 2, avg: 20 }),
        expect.objectContaining({ value: 'offer', count: 1, avg: 10 }),
      ]),
    )
  })

  it('adds a figure up, and says over how many records', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', aggregate: 'avg', of: 'daysToReply' })
    // Rice took 20, Baylor 10; the two that never heard back are not zeros.
    expect(out).toMatchObject({ of: 'daysToReply', count: 2, avg: 15, min: 10, max: 20 })
  })

  it('gives the earliest and latest of a date field', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', aggregate: 'min', of: 'submittedOn' })
    expect(out).toMatchObject({ count: 3, min: '2026-08-20', max: '2026-09-10' })
  })

  it('counts with a filter', () => {
    const { memory } = store()
    expect(list(memory(), { type: 'application', where: [{ field: 'outcome', op: 'ne', value: 'rejected' }], aggregate: 'count' })).toEqual({ count: 3 })
  })

  it('refuses a field no record has, and names the ones they do', () => {
    // A filter on `dueDate` that matched nothing would read as "nothing is due".
    const { memory } = store()
    const out = list(memory(), { type: 'application', orderBy: 'dueDate' })
    expect(out['ok']).toBe(false)
    expect(out['hint']).toMatch(/No application has "dueDate"/)
    expect(out['hint']).toMatch(/deadline/)
  })

  it('refuses min without the field it is over', () => {
    const { memory } = store()
    expect(list(memory(), { type: 'application', aggregate: 'max' })).toMatchObject({ ok: false })
  })

  it('leaves a plain listing exactly as it was: newest first, counts in front', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application' }) as unknown as Listed
    expect(Object.keys(out)).toEqual(['total', 'shown', 'matches'])
    // SMU was filed last of the four that were not touched again afterwards.
    expect(out.matches.map((m) => m['employer'])).toContain('SMU')
    expect(out.total).toBe(4)
  })

  it('names what a field holds when an exact match finds nothing', () => {
    // "Houston" against "Houston, TX": the empty answer was read as "none".
    const { memory } = store()
    const out = list(memory(), { type: 'application', where: [{ field: 'employer', op: 'eq', value: 'Ric' }] })
    expect(out).toMatchObject({ total: 0 })
    expect(out['hint']).toMatch(/"employer" holds .*"Rice"/)
    expect(out['hint']).toMatch(/contains/)
    const found = list(memory(), { type: 'application', where: [{ field: 'employer', op: 'contains', value: 'Ric' }] })
    expect(employers(found)).toEqual(['Rice'])
    expect(found).not.toHaveProperty('hint')
  })

  it('answers an empty store with nothing, not with "no such field"', () => {
    const memory = harness().memory()
    const out = list(memory, { type: 'application', orderBy: 'deadline' })
    expect(out).toMatchObject({ total: 0, matches: [] })
  })
})

describe('the comparison rules', () => {
  it('resolves today, today+N and today-N, and leaves other text alone', () => {
    expect(resolveValue('today', TODAY)).toBe('2026-10-22')
    expect(resolveValue('today+10', TODAY)).toBe('2026-11-01')
    expect(resolveValue('today - 30 days', TODAY)).toBe('2026-09-22')
    expect(resolveValue(['today', 'x'], TODAY)).toEqual(['2026-10-22', 'x'])
    expect(resolveValue('todayish', TODAY)).toBe('todayish')
  })

  it('compares an instant with a day on its day', () => {
    // `lastActionAt gte today-7` is the natural way to ask "touched this week".
    const bag = { lastActionAt: '2026-10-20T23:59:00.000Z' }
    expect(passes(bag, { field: 'lastActionAt', op: 'gte', value: 'today-7' }, TODAY)).toBe(true)
    expect(passes(bag, { field: 'lastActionAt', op: 'eq', value: '2026-10-20' }, TODAY)).toBe(true)
  })

  it('takes a boolean by its spelling, and a number written as text', () => {
    expect(passes({ flagged: true }, { field: 'flagged', op: 'eq', value: 'true' }, TODAY)).toBe(true)
    expect(passes({ upcoming: 3 }, { field: 'upcoming', op: 'gte', value: '2' }, TODAY)).toBe(true)
  })

  it('never orders a missing value', () => {
    expect(passes({}, { field: 'deadline', op: 'lt', value: 'today' }, TODAY)).toBe(false)
    expect(passes({}, { field: 'deadline', op: 'gt', value: 'today' }, TODAY)).toBe(false)
  })

  it('reads one level of dots', () => {
    expect(fieldOf({ offer: { respondBy: '2026-12-01' } }, 'offer.respondBy')).toBe('2026-12-01')
    expect(fieldOf({ offer: null }, 'offer.respondBy')).toBeUndefined()
  })
})

describe('questions about linked records', () => {
  it('tests one linked record on several fields at once', () => {
    // Rice has an October interview and a November deadline. "An interview in
    // November" is neither, and a test that checked kind and month on
    // different items would say Rice.
    const { memory } = store()
    const interviewIn = (month: string) =>
      employers(
        list(memory(), {
          type: 'application',
          related: [
            {
              type: 'timelineItem',
              where: [
                { field: 'kind', op: 'eq', value: 'interview' },
                { field: 'date.month', op: 'eq', value: month },
              ],
            },
          ],
        }),
      )
    expect(interviewIn('2026-10')).toEqual(['Rice'])
    expect(interviewIn('2026-11')).toEqual([])
  })

  it('finds the records with NONE, with atMost 0', () => {
    const { memory } = store()
    const out = list(memory(), {
      type: 'application',
      related: [
        {
          type: 'timelineItem',
          where: [
            { field: 'kind', op: 'eq', value: 'deadline' },
            { field: 'done', op: 'eq', value: false },
          ],
          atMost: 0,
        },
      ],
    })
    expect(employers(out).sort()).toEqual(['Baylor', 'SMU'])
  })

  it('counts linked records that pass, with atLeast', () => {
    // UNT has two items, but one is done; only Rice has two still open.
    const { memory } = store()
    const out = list(memory(), {
      type: 'application',
      related: [{ type: 'timelineItem', where: [{ field: 'done', op: 'eq', value: false }], atLeast: 2 }],
    })
    expect(employers(out)).toEqual(['Rice'])
  })

  it('works the other way round: timeline items by their application', () => {
    const { memory } = store()
    const out = list(memory(), {
      type: 'timelineItem',
      related: [{ type: 'application', where: [{ field: 'employer', op: 'eq', value: 'UNT' }] }],
    }) as unknown as Listed
    expect(out.matches.map((m) => m['title']).sort()).toEqual(['UNT deadline', 'UNT early round'])
  })

  it('refuses a linked kind that does not exist, naming the ones that do', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', related: [{ type: 'interview' }] })
    expect(out['hint']).toMatch(/"interview" is not a kind of record.*timelineItem/)
  })

  it('refuses a field the linked kind does not have', () => {
    const { memory } = store()
    const out = list(memory(), {
      type: 'application',
      related: [{ type: 'timelineItem', where: [{ field: 'stage', op: 'eq', value: 'offer' }] }],
    })
    expect(out['ok']).toBe(false)
    expect(out['hint']).toMatch(/No linked timelineItem has "stage"/)
  })
})

describe('the other shapes a question takes', () => {
  it('takes OR with match: any', () => {
    const { memory } = store()
    const out = list(memory(), {
      type: 'application',
      match: 'any',
      where: [
        { field: 'employer', op: 'eq', value: 'SMU' },
        { field: 'stage', op: 'eq', value: 'offer' },
      ],
    })
    expect(employers(out).sort()).toEqual(['Baylor', 'SMU'])
  })

  it('groups by a part of a date, in date order when asked', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', groupBy: 'submittedOn.month', orderBy: 'submittedOn.month' })
    expect(out['groups']).toEqual([
      { value: '2026-08', count: 1 },
      { value: '2026-09', count: 2 },
      { value: null, count: 1 },
    ])
  })

  it('measures the days between two date fields', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', aggregate: 'median', of: 'days(submittedOn, firstReplyOn)' })
    expect(out).toMatchObject({ count: 2, min: 10, max: 20, avg: 15, median: 15 })
  })

  it('excludes, including the records with nothing there', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', where: [{ field: 'keywords', op: 'excludes', value: 'Research' }] })
    expect(employers(out).sort()).toEqual(['Baylor', 'SMU'])
  })

  it('shows only the fields asked for, and always the id and label', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', fields: ['deadline'] }) as unknown as Listed
    for (const m of out.matches) expect(Object.keys(m).every((k) => ['id', 'type', 'label', 'deadline'].includes(k))).toBe(true)
    expect(out.matches.some((m) => m['deadline'] === '2026-11-30')).toBe(true)
    expect(list(memory(), { type: 'application', fields: ['dueDate'] })).toMatchObject({ ok: false })
  })

  it('pages with offset, and still reports every match', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'application', orderBy: 'employer', offset: 2, limit: 1 })
    expect(employers(out)).toEqual(['SMU'])
    expect(out).toMatchObject({ total: 4, shown: 1, offset: 2 })
  })
})

describe('date parts', () => {
  it('names the weekday and the ISO week', () => {
    expect(fieldOf({ d: '2026-10-22' }, 'd.weekday')).toBe('Thursday')
    expect(fieldOf({ d: '2026-10-22' }, 'd.week')).toBe('2026-W43')
    // A Friday on New Year's Day belongs to the last week of the year before.
    expect(fieldOf({ d: '2027-01-01' }, 'd.week')).toBe('2026-W53')
    expect(fieldOf({ d: '2026-10-22T23:00:00.000Z' }, 'd.year')).toBe('2026')
    expect(fieldOf({ d: 'not a date' }, 'd.month')).toBeUndefined()
  })
})

describe('what a model actually writes', () => {
  it('measures days between two dates in either order', () => {
    // GPT-OSS wrote the pair backwards and every gap came out negative.
    expect(fieldOf({ a: '2026-09-01', b: '2026-09-21' }, 'days(b, a)')).toBe(20)
    expect(fieldOf({ a: '2026-09-01', b: '2026-09-21' }, 'days(a, b)')).toBe(20)
  })

  it('reads a related test written flat as its one condition', () => {
    // Gemma's shape for "an interview in November": no `where`, the condition
    // on the test itself. Dropped, it became "has any timeline item".
    const { memory } = store()
    const out = list(memory(), {
      type: 'application',
      related: [{ type: 'timelineItem', field: 'kind', op: 'eq', value: 'interview' }],
    })
    expect(employers(out)).toEqual(['Rice'])
  })

  it('matches a month by its number or its name', () => {
    for (const value of [10, '10', 'Oct', 'october', '2026-10']) {
      expect(passes({ d: '2026-10-28' }, { field: 'd.month', op: 'eq', value }, TODAY), String(value)).toBe(true)
    }
    expect(passes({ d: '2026-10-28' }, { field: 'd.month', op: 'eq', value: 11 }, TODAY)).toBe(false)
    expect(passes({ d: '2026-11-02' }, { field: 'd.month', op: 'gte', value: 'Nov' }, TODAY)).toBe(true)
  })

  it('says so when a related test is aimed at a kind nothing is linked to', () => {
    // Timeline items are not linked to timeline items; the empty list read as
    // "there are no interviews".
    const { memory } = store()
    const out = list(memory(), {
      type: 'timelineItem',
      related: [{ type: 'timelineItem', where: [{ field: 'kind', op: 'eq', value: 'interview' }] }],
    })
    expect(out).toMatchObject({ total: 0 })
    expect(out['hint']).toMatch(/not linked to any timelineItem|none of these records is linked/)
    expect(out['hint']).toMatch(/"where"/)
  })
})

describe('the names a model brings with it', () => {
  it('sorts on a field the kind declares even when no record has filled it in', () => {
    // `appliedOn` is real; refusing it as unknown was a false statement.
    const { memory } = store()
    const out = list(memory(), { type: 'application', orderBy: 'appliedOn' })
    expect(out).toMatchObject({ total: 4 })
  })

  it('reads a record id in a filter as that record\'s name', () => {
    // The id `memory.search` handed over, against a field of names.
    const { memory, keyword } = store()
    const out = list(memory(), { type: 'application', where: [{ field: 'keywords', op: 'contains', value: keyword }] })
    expect(employers(out).sort()).toEqual(['Rice', 'UNT'])
  })

  it('still means the id when filtering on the id', () => {
    const { memory, unt } = store()
    expect(employers(list(memory(), { type: 'application', where: [{ field: 'id', op: 'eq', value: unt }] }))).toEqual(['UNT'])
  })

  it('names a timeline item\'s application by role AND employer', () => {
    const { memory } = store()
    const out = list(memory(), { type: 'timelineItem', groupBy: 'application' })
    expect(out['groups']).toEqual([
      { value: 'Assistant professor, CS — Rice', count: 3 },
      { value: 'Assistant professor, CS — UNT', count: 2 },
    ])
  })
})
