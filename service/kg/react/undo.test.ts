/**
 * The Undo four toasts did not have, against a real journal.
 *
 * Built on the memory driver rather than a fake ring, because the three things
 * that can go wrong here are all properties of `repo.revert` and not of the
 * bookkeeping around it: an entry that has already been undone lives in the
 * AUDIT ring, where `revert` still finds it and would apply it a second time; a
 * burst has to come out newest first or a record is put back before the thing
 * that pointed at it has been taken away; and `before` is a WHOLE record, so
 * reverting an entry the user has written over since discards what they wrote.
 *
 * That last one — A4 — survived a five-case suite in which no test wrote to the
 * same record twice, which is the only shape it can appear in. Several tests
 * below therefore write to one record from two separate commits on purpose.
 */

import { describe, expect, it } from 'vitest'
import type { Instant, StoredEdge, StoredNode } from '../core/model'
import { MutableSnapshot } from '../core/snapshot'
import { createMemoryDriver } from '../storage/memory-driver'
import type { JournalDraft } from '../repo/journal'
import { freshMeta } from '../repo/meta'
import { createRepository } from '../repo/repository'
import { undoableWith } from './undo'

const AT: Instant = '2026-10-12T09:00:00.000Z'

const application = (slug: string, note = ''): StoredNode => ({
  id: `app:${slug}`,
  type: 'application',
  props: {
    slug,
    role: 'Statistics',
    note,
    roleTag: 'Assistant Professor',
    stage: 'draft',
    lastAction: 'Draft created',
    lastActionAt: AT,
  },
  createdAt: AT,
  updatedAt: AT,
})

const putting = (node: StoredNode, before: StoredNode | null = null): JournalDraft => ({
  tool: 'application.create',
  input: {},
  label: `${node.id} written`,
  calls: [],
  nodes: [{ id: node.id, before, after: node }],
  edges: [],
})

const tagging = (edge: StoredEdge, before: StoredEdge | null = null): JournalDraft => ({
  tool: 'application.tag',
  input: {},
  label: `${edge.id} written`,
  calls: [],
  nodes: [],
  edges: [{ id: edge.id, before, after: edge }],
})

const tag = (from: string, to: string): StoredEdge => ({
  id: `${from}|TAGS|${to}`,
  rel: 'TAGS',
  from,
  to,
  props: {},
  createdAt: AT,
})

const noteOf = (repo: ReturnType<typeof setup>, id: string) =>
  repo.getSnapshot().node(id, 'application')?.props.note

function setup(nodes: StoredNode[] = []) {
  let tick = 0
  return createRepository({
    driver: createMemoryDriver(),
    snapshot: MutableSnapshot.from(nodes, []),
    meta: freshMeta(AT, 'demo'),
    now: () => {
      tick += 1
      return `2026-10-12T09:00:${String(tick).padStart(2, '0')}.000Z`
    },
  })
}

describe('undoableWith', () => {
  it('reverts every entry the action committed, not only the last', () => {
    const repo = setup()

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice')))
      repo.commit(putting(application('rice-deadline')))
    })

    expect(repo.getSnapshot().node('app:rice')).toBeDefined()
    restore?.()

    // Both gone. Undoing only the newest is what would have left a deadline on
    // the calendar pointing at an application that no longer existed.
    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(repo.getSnapshot().node('app:rice-deadline')).toBeUndefined()
  })

  it('leaves writes made before the action alone', () => {
    const repo = setup()
    repo.commit(putting(application('tamu')))

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice')))
    })
    restore?.()

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(repo.getSnapshot().node('app:tamu')).toBeDefined()
  })

  it('hands back a null restore when the action committed nothing', () => {
    const repo = setup()

    // A save with nothing behind it: `repo.commit` keeps an empty entry off the
    // undo stack, so there is nothing to offer and the toast must not offer it.
    const { restore } = undoableWith(repo, () => {
      repo.commit({
        tool: 'profile.set',
        input: {},
        label: 'Profile saved',
        calls: [],
        nodes: [],
        edges: [],
      })
    })

    expect(restore).toBeNull()
  })

  /**
   * The failure this guards is silent and looks like the opposite of a bug: the
   * record comes BACK. ⌘Z moves the entry off the undo ring onto redo, and a
   * second `revert` of the same id finds it there and inverts the inverse.
   */
  it('skips an entry that has already been undone', () => {
    const repo = setup()

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice')))
    })

    const head = repo.undoable[0]
    expect(head).toBeDefined()
    repo.revert(head!.id)
    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()

    const outcome = restore?.()

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    // Counted, not announced: ⌘Z was itself a visible undo, so the record is
    // already in the state the second press was asking for.
    expect(outcome).toEqual({ reverted: 0, superseded: [], alreadyUndone: 1 })
  })

  /**
   * A4, in the shape the profile page produces it.
   *
   * The save bar and the two switches write the SAME node through the same
   * tool, and the switches commit on click while the save toast is still on
   * screen. `before` is a whole record, so reverting the save would have put the
   * switch back with it — and the page's own draft state hid that on screen.
   */
  it('leaves an entry alone when the record was written again after the action', () => {
    const repo = setup([application('rice', 'as it was')])

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice', 'saved'), application('rice', 'as it was')))
    })

    // The flip: a second mechanism, writing the same record, inside the toast's
    // eight seconds.
    repo.commit(putting(application('rice', 'flipped'), application('rice', 'saved')))

    const outcome = restore?.()

    expect(noteOf(repo, 'app:rice')).toBe('flipped')
    expect(outcome?.reverted).toBe(0)
    expect(outcome?.superseded).toEqual(['app:rice written'])
  })

  it('says which entry it left alone, so the button does not decline in silence', () => {
    const repo = setup([application('rice', 'as it was')])

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice', 'saved'), application('rice', 'as it was')))
      repo.commit(putting(application('rice-deadline')))
    })

    repo.commit(putting(application('rice', 'flipped'), application('rice', 'saved')))

    const outcome = restore?.()

    // The half that had not moved on still comes back; the half that had is
    // named rather than dropped on the floor.
    expect(repo.getSnapshot().node('app:rice-deadline')).toBeUndefined()
    expect(noteOf(repo, 'app:rice')).toBe('flipped')
    expect(outcome?.reverted).toBe(1)
    expect(outcome?.superseded).toEqual(['app:rice written'])
  })

  it('notices a later write to an edge the action created', () => {
    const repo = setup([application('rice')])

    const { restore } = undoableWith(repo, () => {
      repo.commit(tagging(tag('kw:stats', 'app:rice')))
    })

    // Untagged again by hand. The node deltas are untouched here, so an entry
    // checked on its nodes alone would have read as current.
    repo.commit({
      ...tagging(tag('kw:stats', 'app:rice')),
      edges: [{ id: 'kw:stats|TAGS|app:rice', before: tag('kw:stats', 'app:rice'), after: null }],
    })

    const outcome = restore?.()

    expect(repo.getSnapshot().edge('kw:stats|TAGS|app:rice')).toBeUndefined()
    expect(outcome?.reverted).toBe(0)
    expect(outcome?.superseded).toHaveLength(1)
  })

  it('is not blocked by a later write to some other record', () => {
    const repo = setup()

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice')))
    })

    // The common case the guard must not swallow: the user keeps working, on
    // something else, while the toast is up.
    repo.commit(putting(application('tamu')))

    const outcome = restore?.()

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(repo.getSnapshot().node('app:tamu')).toBeDefined()
    expect(outcome?.reverted).toBe(1)
    expect(outcome?.superseded).toEqual([])
  })

  /**
   * The trap in the fix rather than in the bug: `application.create` writes the
   * record, then its keywords, then the deadline, so the burst's own later
   * entries write records its earlier entries wrote. Deciding staleness once, up
   * front, would call the first entry superseded by the second and undo only
   * half of a create.
   */
  it('reverts a burst that wrote the same record twice', () => {
    const repo = setup()

    const { restore } = undoableWith(repo, () => {
      repo.commit(putting(application('rice', 'first')))
      repo.commit(putting(application('rice', 'second'), application('rice', 'first')))
    })

    const outcome = restore?.()

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
    expect(outcome?.reverted).toBe(2)
    expect(outcome?.superseded).toEqual([])
  })

  it('returns whatever the write returned, so the caller can still navigate to it', () => {
    const repo = setup()

    const { value } = undoableWith(repo, () => {
      repo.commit(putting(application('rice')))
      return 'app:rice'
    })

    expect(value).toBe('app:rice')
  })
})
