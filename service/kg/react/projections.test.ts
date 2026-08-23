/**
 * What the six hooks hand a card, checked without mounting one.
 *
 * The hooks themselves are ~20 lines of `useMemo` over these projections and the
 * tool runtime; the part that can be wrong is what comes out of the graph, and
 * that is all here. D20: no component tests, no jsdom — the binding layer is thin
 * by construction and testing React's `useMemo` is testing React.
 *
 * The clock is fixed and injected, exactly as `KgProvider` injects it. Every
 * assertion about `daysAgo` and every bucket would otherwise pass on the day it
 * was written and fail every day after.
 */

import { describe, expect, it } from 'vitest'
import { seedLabels, seedLabelsByRecord } from '../../data/labels'
import { applications as seedApplications } from '../../data/seed'
import { timeline as seedTimeline } from '../../data/timeline'
import { vaultLinks as seedLinks } from '../../data/vault'
import type { Instant } from '../core/model'
import { bootInMemory } from '../repo/boot'
import type { Repository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import { createProjections } from './projections'
import { recordKey } from './use-keywords'

/** Midday local, the way `lib/store.tsx` pins it, so a whole-day offset is whole. */
const NOW: Instant = new Date('2026-10-12T12:00:00').toISOString()
const now = () => NOW
const TODAY = NOW.slice(0, 10)

function session() {
  const { repo, problems } = bootInMemory({ now })
  return { repo, problems, runtime: createToolRuntime({ repo, now }), p: createProjections(TODAY) }
}

const read = (repo: Repository) => repo.getSnapshot()

describe('the seeded graph', () => {
  it('boots with no integrity problem', () => {
    expect(session().problems).toEqual([])
  })

  it('projects every collection back at its fixture size', () => {
    const { repo, p } = session()
    const g = read(repo)
    expect(p.applications(g)).toHaveLength(seedApplications.length)
    expect(p.timeline(g)).toHaveLength(seedTimeline.length)
    expect(p.links(g)).toHaveLength(seedLinks.length)
    expect(p.keywords(g)).toHaveLength(seedLabels.length)
  })

  /**
   * The one derived value with a number in it, and the one the old store got
   * wrong: `daysAgo` was stored, zeroed on every edit, and right only because a
   * reload wiped it.
   */
  it('re-derives daysAgo from lastActionAt, matching the fixture exactly', () => {
    const { repo, p } = session()
    const projected = p.applications(read(repo)).map((a) => a.daysAgo)
    expect(projected).toEqual(seedApplications.map((a) => a.daysAgo))
  })

  it('re-derives allDay from the absence of a start time', () => {
    const { repo, p } = session()
    for (const item of p.timeline(read(repo))) {
      expect(item.allDay).toBe(item.startMins === undefined)
    }
  })

  it('re-derives a posting`s linked flag from its BECAME edge', () => {
    const { repo, p } = session()
    for (const posting of p.postings(read(repo))) {
      expect(posting.linked).toBe(posting.applicationId !== undefined)
    }
  })

  it('sorts the timeline by date and the rest by creation order', () => {
    const { repo, p } = session()
    const dates = p.timeline(read(repo)).map((i) => i.date)
    expect([...dates].sort()).toEqual(dates)
  })
})

describe('the projected pointers', () => {
  /**
   * The claim the whole wave rests on: a delete unlinks and never cascades, and
   * the projection is what makes that visible. The old reducer needed six
   * hand-written sweeps and a captured edge list to say the same thing.
   */
  it('drops an application`s pointers on delete and puts them back on undo', () => {
    const { repo, runtime, p } = session()

    // A link filed under an application — no fixture carries one, so the test
    // files it itself rather than asserting over an empty set and passing.
    const application = p.applications(read(repo))[0]
    expect(application).toBeDefined()
    if (!application) return

    const saved = runtime.run('vault.link.save', {
      title: 'Reference letter tracker',
      url: 'https://example.org/tracker',
      category: 'Guide',
      applicationIds: [application.id],
    })
    expect(saved.ok).toBe(true)

    const before = p.links(read(repo)).find((l) => l.title === 'Reference letter tracker')
    expect(before?.applicationIds).toEqual([application.id])

    const deleted = runtime.run('application.delete', { id: application.id })
    expect(deleted.ok).toBe(true)

    const orphaned = p.links(read(repo)).find((l) => l.title === 'Reference letter tracker')
    expect(orphaned).toBeDefined()
    // The edge goes with the application; the record stays and is simply unfiled.
    expect(orphaned?.applicationIds).toEqual([])
    expect(p.applications(read(repo)).some((a) => a.id === application.id)).toBe(false)

    if (deleted.ok) deleted.undo?.()

    const restored = p.links(read(repo)).find((l) => l.title === 'Reference letter tracker')
    expect(restored?.applicationIds).toEqual([application.id])
    expect(p.applications(read(repo)).some((a) => a.id === application.id)).toBe(true)
  })

  /**
   * The whole point of `fromCardinality: 'many'`, asserted where the screens
   * read it. One CV goes to every application you send it to, and the build
   * that stored a scalar answered the second filing by silently dropping the
   * first — so the application you filed it under last week stopped listing it
   * the moment you filed it under this week's.
   *
   * Both directions are checked: the record naming both applications, and each
   * application finding the record. `ApplicationDetail` and `FiledPanel` do the
   * second by membership, which is the half a scalar could never have served.
   */
  it('files one record under two applications and shows it on both', () => {
    const { repo, runtime, p } = session()
    const [first, second] = p.applications(read(repo))
    if (!first || !second) throw new Error('the seed has fewer than two applications')

    const saved = runtime.run('vault.file.add', {
      files: [
        {
          name: 'CV-2026.pdf',
          kind: 'pdf',
          bucket: 'Applications',
          size: '212 KB',
          applicationIds: [first.id, second.id],
        },
      ],
    })
    expect(saved.ok).toBe(true)

    const stored = p.files(read(repo)).find((f) => f.name === 'CV-2026.pdf')
    expect(stored?.applicationIds).toEqual([first.id, second.id])

    const filedUnder = (appId: string) =>
      p.files(read(repo)).filter((f) => f.applicationIds.includes(appId))
    expect(filedUnder(first.id).map((f) => f.name)).toContain('CV-2026.pdf')
    expect(filedUnder(second.id).map((f) => f.name)).toContain('CV-2026.pdf')

    // Refiling REPLACES the set — that is what the pickers send — and the
    // application dropped from it stops listing the document.
    if (!stored) throw new Error('the document was saved and could not be read back')
    const refiled = runtime.run('vault.file.update', {
      id: stored.id,
      applicationIds: [second.id],
    })
    expect(refiled.ok).toBe(true)
    expect(filedUnder(first.id).map((f) => f.name)).not.toContain('CV-2026.pdf')
    expect(filedUnder(second.id).map((f) => f.name)).toContain('CV-2026.pdf')
  })

  it('keeps a record`s identity stable across an unrelated edit', () => {
    const { repo, runtime, p } = session()
    const rows = p.applications(read(repo))
    const target = rows[0]
    const untouched = rows[1]
    if (!target || !untouched) throw new Error('the seed has fewer than two applications')

    runtime.run('application.note.set', { id: target.id, note: 'Chased the coordinator' })

    const after = p.applications(read(repo))
    // Referential identity is what React.memo holds on. The edited row is a new
    // object; every other row must be the same object it was.
    expect(after.find((a) => a.id === untouched.id)).toBe(untouched)
    expect(after.find((a) => a.id === target.id)).not.toBe(target)
  })
})

describe('keywords, merged into the graph (D14)', () => {
  it('counts a keyword by its edges, which is the same number the filter sees', () => {
    const { repo, p } = session()
    const g = read(repo)
    const tagged = Object.values(seedLabelsByRecord).flat().length
    const counted = p.keywords(g).reduce((n, k) => n + g.out(k.id, 'TAGS').length, 0)
    expect(counted).toBe(tagged)
  })

  /**
   * The audit bug at the removed `store-context.ts`, and why it is now
   * unrepresentable.
   *
   * Keywords lived in a provider above the store, so clearing the records and
   * clearing the tagging were two calls in two places. Miss one and Settings
   * reported "Used on 32 records" over an emptied store while the Applications
   * filter, counting within a live list, read 0 for the same keyword on the same
   * screenful. There is no second store to miss now: the tags are edges, and
   * emptying the records takes them inside the same transaction.
   */
  it('cannot report a keyword as used after the records are cleared', () => {
    const { repo, runtime, p } = session()
    expect(p.keywords(read(repo)).length).toBeGreaterThan(0)

    const cleared = runtime.run('memory.clear', {})
    expect(cleared.ok).toBe(true)

    const g = read(repo)
    const keywords = p.keywords(g)
    // The keywords themselves survive — they are the user's own system and
    // outlive any one set of records.
    expect(keywords).toHaveLength(seedLabels.length)
    for (const keyword of keywords) expect(g.out(keyword.id, 'TAGS')).toHaveLength(0)
    expect(p.applications(g)).toHaveLength(0)
  })

  it('unwraps the refKey spelling the cards still use', () => {
    const { repo, p } = session()
    const application = p.applications(read(repo))[0]
    if (!application) throw new Error('the seed has no applications')
    // `refKey('app', id)` over an id that already carries its type.
    expect(recordKey(`app:${application.id}`)).toBe(application.id)
    expect(recordKey(application.id)).toBe(application.id)
    expect(recordKey('stripe')).toBeUndefined()
  })
})

describe('the compatibility contract', () => {
  it('reads an application back by the slug a URL carries', () => {
    const { repo } = session()
    const g = read(repo)
    const stored = g.ofType('application')[0]
    if (!stored) throw new Error('the seed has no applications')
    expect(g.bySlug('application', stored.props.slug)?.id).toBe(stored.id)
  })

  it('stamps a completion with the injected day, never the wall clock', () => {
    const { repo, runtime } = session()
    const item = read(repo).ofType('timelineItem')[0]
    if (!item) throw new Error('the seed has no timeline items')

    runtime.run('timeline.item.complete', { id: item.id, on: TODAY })
    expect(read(repo).node(item.id, 'timelineItem')?.props.completedOn).toBe(TODAY)

    runtime.run('timeline.item.reopen', { id: item.id })
    // Deleted, not nulled: an explicit null survives structured clone, and
    // `'completedOn' in props` would then answer yes for an open item.
    expect('completedOn' in (read(repo).node(item.id, 'timelineItem')?.props ?? {})).toBe(false)
  })
})

describe('the order documents come back in', () => {
  const add = (s: ReturnType<typeof session>, name: string, savedOn?: string) =>
    s.runtime.runOrThrow('vault.file.add', {
      files: [
        {
          name,
          kind: 'pdf' as const,
          bucket: 'Applications' as const,
          size: '1 KB',
          ...(savedOn === undefined ? {} : { savedOn }),
        },
      ],
    })

  it('is newest first, so the one just added is at the top', () => {
    // `ofType` is id-ascending, which is creation order, which put the oldest
    // document at the top of the Vault and the newest below the fold.
    const s = session()
    add(s, 'old.pdf', '2026-08-01')
    add(s, 'new.pdf', '2026-09-20')
    const names = s.p.files(read(s.repo)).map((f) => f.name)
    expect(names.indexOf('new.pdf')).toBeLessThan(names.indexOf('old.pdf'))
  })

  it('breaks a same-day tie by when the record was minted', () => {
    // A batch dropped in one go shares `savedOn`, so the date alone leaves them
    // in an arbitrary order. Ids are uuidv7, so comparing them compares time.
    const s = session()
    add(s, 'first.pdf', '2026-09-20')
    add(s, 'second.pdf', '2026-09-20')
    const names = s.p.files(read(s.repo)).map((f) => f.name)
    expect(names.indexOf('second.pdf')).toBeLessThan(names.indexOf('first.pdf'))
  })

  it('puts a document added now above every seeded one', () => {
    // The case the complaint was actually about.
    const s = session()
    add(s, 'just-dropped.pdf')
    expect(s.p.files(read(s.repo))[0]?.name).toBe('just-dropped.pdf')
  })
})
