/**
 * The Undo four toasts did not have, against a real journal.
 *
 * Built on the memory driver rather than a fake ring, because the two things
 * that can go wrong here are both properties of `repo.revert` and not of the
 * bookkeeping around it: an entry that has already been undone lives in the
 * AUDIT ring, where `revert` still finds it and would apply it a second time,
 * and a burst has to come out newest first or a record is put back before the
 * thing that pointed at it has been taken away.
 */

import { describe, expect, it } from 'vitest'
import type { Instant, StoredNode } from '@/kg/core/model'
import { MutableSnapshot } from '@/kg/core/snapshot'
import { createMemoryDriver } from '@/kg/storage/memory-driver'
import type { JournalDraft } from '@/kg/repo/journal'
import { freshMeta } from '@/kg/repo/meta'
import { createRepository } from '@/kg/repo/repository'
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

    restore?.()

    expect(repo.getSnapshot().node('app:rice')).toBeUndefined()
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
