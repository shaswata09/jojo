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
import { applications as seedApplications } from '../../data/demo-applications'
import { timeline as seedTimeline } from '../../data/timeline'
import { vaultLinks as seedLinks } from '../../data/vault'
import type { Instant } from '../core/model'
import { dayOf } from '../core/project'
import { bootInMemory } from '../repo/boot'
import type { Repository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import { createProjections } from './projections'
import { recordKey } from './use-keywords'

/** Midday local, the way `lib/store.tsx` pins it, so a whole-day offset is whole. */
const NOW: Instant = new Date('2026-10-12T12:00:00').toISOString()
const now = () => NOW

/**
 * `dayOf`, because that is what `KgProvider` injects — see `react/kg.tsx`.
 *
 * This was `NOW.slice(0, 10)`, which is the UTC day, and the projections it
 * feeds measure `daysAgo` as `daysBetween(dayOf(lastActionAt), today)` — a LOCAL
 * day on one side of the subtraction and a UTC day on the other. Midday hid it:
 * at 12:00 local the two spellings name the same date in every zone inside ±12,
 * so the suite passed and would have gone on passing had the app adopted the
 * slice. A test that pins the bug it is meant to catch is worse than no test,
 * and `injects the LOCAL day` below is the case where the two come apart.
 */
const TODAY = dayOf(NOW)

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

  // "and the rest by creation order" until the Vault's filed lists stopped
  // using it. The body only ever asserted the timeline half, so the title would
  // have gone on claiming the other half indefinitely without failing.
  it('sorts the timeline by date', () => {
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

  /**
   * The day the provider injects, at the one hour where its spelling matters.
   *
   * `NOW` is midday, where the local day and the UTC day of the same instant
   * agree everywhere inside ±12 — which is why the old `NOW.slice(0, 10)` never
   * failed. So this picks an hour where they cannot agree: late local evening
   * west of UTC, where the ISO string has already rolled over, and early local
   * morning east of it, where the string has not caught up.
   *
   * AT UTC THE TWO ARE THE SAME DAY and no test can separate them — the second
   * assertion says so out loud rather than pretending otherwise. Everywhere
   * else it is what kills the slice.
   */
  it('measures daysAgo against the LOCAL day of the injected instant', () => {
    // `new Date(NOW)` rather than a bare `new Date()`: D26, and the offset of a
    // known instant is the one we want anyway.
    const offsetMins = new Date(NOW).getTimezoneOffset() // UTC − local, in minutes
    const awkward: Instant = (
      offsetMins > 0
        ? new Date(2026, 9, 12, 23, 30) // west: the ISO string is already the 13th
        : new Date(2026, 9, 12, 0, 30)
    ) // east: the ISO string is still the 11th
      .toISOString()

    const at = () => awkward
    const { repo } = bootInMemory({ now: at })
    const runtime = createToolRuntime({ repo, now: at })

    const local = createProjections(dayOf(awkward))
    const sliced = createProjections(awkward.slice(0, 10))
    const target = local.applications(read(repo))[0]
    if (!target) throw new Error('the seed has no applications')

    // `touch` stamps `lastActionAt: ctx.now`, so the record was acted on this
    // very instant and is zero days old.
    runtime.runOrThrow('application.note.set', { id: target.id, note: 'Chased' })
    const daysAgoOf = (p: ReturnType<typeof createProjections>) =>
      p.applications(read(repo)).find((a) => a.id === target.id)?.daysAgo

    expect(daysAgoOf(local)).toBe(0)
    if (dayOf(awkward) !== awkward.slice(0, 10)) {
      expect(daysAgoOf(sliced)).not.toBe(0)
    }
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

/*
 * The Vault's four lists, and the one rule they now share.
 *
 * Three of them had the same defect: `ofType` is id-ascending, which is
 * creation order, which puts the OLDEST record at the top and the newest below
 * the fold. Documents were fixed first, on the complaint the suite below
 * records; links and snippets were left behind, so the Vault ordered one of its
 * lists one way and two the other.
 *
 * The two sort keys are NOT interchangeable, and the seeded data is what proves
 * it. The link fixtures happen to be authored in descending `savedOn` order, so
 * their ids ascend as their dates descend — sorting links by id descending, the
 * key snippets correctly use, would put the oldest link first and invert the
 * whole list. That is the trap the last test in the links suite holds shut.
 *
 * Reminders are the deliberate exception and are not here at all: they come
 * from the timeline projection, they stay in due-date order, and `remindersOf`
 * in `core/dates.ts` carries both the reason and the tests that stop somebody
 * "finishing the job" later.
 */

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

describe('the order links come back in', () => {
  const add = (s: ReturnType<typeof session>, title: string, savedOn?: string) =>
    s.runtime.runOrThrow('vault.link.save', {
      title,
      url: `https://example.com/${title}`,
      category: 'Posting' as const,
      ...(savedOn === undefined ? {} : { savedOn }),
    })

  it('is newest first, so the one just saved is at the top', () => {
    const s = session()
    add(s, 'old', '2026-08-01')
    add(s, 'new', '2026-09-20')
    const titles = s.p.links(read(s.repo)).map((l) => l.title)
    expect(titles.indexOf('new')).toBeLessThan(titles.indexOf('old'))
  })

  it('breaks a same-day tie by when the record was minted', () => {
    // Three links saved while reading one posting share a date, and the date
    // alone would leave them in whatever order the store returned.
    const s = session()
    add(s, 'first', '2026-09-20')
    add(s, 'second', '2026-09-20')
    const titles = s.p.links(read(s.repo)).map((l) => l.title)
    expect(titles.indexOf('second')).toBeLessThan(titles.indexOf('first'))
  })

  it('puts a link added now above every seeded one', () => {
    // The case the complaint was actually about.
    const s = session()
    add(s, 'just-saved')
    expect(s.p.links(read(s.repo))[0]?.title).toBe('just-saved')
  })

  it('orders the seeded links by their filed date, not by their ids', () => {
    /*
     * The trap. The link fixtures are authored newest-first, so their ids
     * ASCEND as their dates DESCEND — which means id-descending, the key
     * snippets correctly use, would invert this list end to end and put the
     * oldest link at the top.
     *
     * Asserted on the seed rather than on records this test made, because the
     * disagreement between the two keys only exists in data somebody authored
     * by hand, and that is exactly the data a person loads to look at.
     */
    const s = session()
    const dates = s.p.links(read(s.repo)).map((l) => l.savedOn)
    expect(dates.length).toBeGreaterThan(1)
    expect([...dates].sort((a, b) => b.localeCompare(a))).toEqual(dates)
  })
})

describe('the order snippets come back in', () => {
  const add = (s: ReturnType<typeof session>, title: string) =>
    s.runtime.runOrThrow('vault.snippet.create', {
      title,
      tag: 'Cover letter' as const,
      body: 'x',
    })

  it('is newest first, so the one just written is at the top', () => {
    /*
     * By id alone, because a snippet carries no date at all — see `Snippet` in
     * `core/model.ts`. That is not the weaker key: ids are uuidv7 with a
     * monotonic counter, so they order records minted inside one millisecond,
     * where a `savedOn` day cannot.
     */
    const s = session()
    add(s, 'older')
    add(s, 'newer')
    const titles = s.p.snippets(read(s.repo)).map((x) => x.title)
    expect(titles.indexOf('newer')).toBeLessThan(titles.indexOf('older'))
  })

  it('orders two written in the same millisecond, which a date could not', () => {
    const s = session()
    add(s, 'a')
    add(s, 'b')
    add(s, 'c')
    expect(
      s.p
        .snippets(read(s.repo))
        .map((x) => x.title)
        .slice(0, 3),
    ).toEqual(['c', 'b', 'a'])
  })

  it('puts a snippet added now above every seeded one', () => {
    const s = session()
    add(s, 'just-written')
    expect(s.p.snippets(read(s.repo))[0]?.title).toBe('just-written')
  })
})

describe('a duplicated record lands where the person is looking', () => {
  /*
   * Two paths duplicate a link and they disagreed about when the copy was
   * filed. The row menus on both platforms re-save through `addLink` with no
   * `savedOn`, so the copy is stamped today; `vault.link.duplicate` spread
   * `...source.props` and carried the ORIGINAL's date across.
   *
   * Oldest-first hid it — every new record went to the bottom either way. With
   * the newest at the top the two answers are a whole list apart: one puts the
   * copy at row 1 beside the toast that offers to undo it, the other puts it
   * halfway down next to its original, off screen.
   */
  it('puts a duplicated link at the top, not beside its original', () => {
    const s = session()
    const old = s.runtime.runOrThrow('vault.link.save', {
      title: 'Rice posting',
      url: 'https://example.com/rice',
      category: 'Posting' as const,
      savedOn: '2020-01-01',
    })
    s.runtime.runOrThrow('vault.link.save', {
      title: 'something newer',
      url: 'https://example.com/newer',
      category: 'Posting' as const,
      savedOn: '2026-01-01',
    })
    s.runtime.runOrThrow('vault.link.duplicate', { id: old })

    const first = s.p.links(read(s.repo))[0]
    expect(first?.title).toBe('Rice posting')
    // Today's date, not 2020's — which is what carries it to the top.
    expect(first?.savedOn).not.toBe('2020-01-01')
  })

  it('puts a duplicated snippet at the top', () => {
    // No date to restamp; the freshly minted id is what does it.
    const s = session()
    const old = s.runtime.runOrThrow('vault.snippet.create', {
      title: 'Short bio',
      tag: 'Bio' as const,
      body: 'x',
    })
    s.runtime.runOrThrow('vault.snippet.create', {
      title: 'something newer',
      tag: 'Bio' as const,
      body: 'y',
    })
    s.runtime.runOrThrow('vault.snippet.duplicate', { id: old })
    expect(s.p.snippets(read(s.repo))[0]?.title).toBe('Short bio')
  })
})
