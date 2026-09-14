/**
 * The four checklist writes, against a real repository.
 *
 * The undo round-trip is in `service/test/coverage.test.ts`, where the harness
 * asserts byte-identity both ways. What is here is everything that is about
 * REFUSING: the duplicate a person types while a model is still thinking, the
 * cap, the unknown id, and the agent's inability to tick anything or blow a
 * list away.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'
import { MAX_CHECKLIST_ITEMS } from '../core/model'
import { mayPropose } from '../core/proposal'
import { TOOLS } from './index'

type Options = Parameters<typeof createRepository>[0]

/** Accepts everything, remembers nothing — durability is not what this asserts. */
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

/** The clock is injected and fixed (D26); nothing here reads a real one. */
function harness() {
  let tick = 0
  const now = () => new Date(START + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: nullDriver(),
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
  return { repo, runtime: createToolRuntime({ repo, now }) }
}

type H = ReturnType<typeof harness>

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}

const anApplication = (h: H): string =>
  okOr(
    h.runtime.run('application.create', {
      org: 'Rice University',
      role: 'Assistant professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
    }),
  )

const listOf = (h: H, id: string) =>
  h.repo.getSnapshot().node(id as never, 'application')?.props.checklist ?? []

const add = (h: H, id: string, text: string) =>
  h.runtime.run('application.checklist.item.add', { id, text })

describe('adding a step', () => {
  it('refuses a duplicate, however it was worded', () => {
    /*
     * Checked in the TOOL and not only in the panel, because of the race this
     * feature has by construction: the drafting run reads the list when it
     * starts and the model thinks for a minute, so a step the person types
     * meanwhile is only catchable by the write inside the transaction.
     */
    const h = harness()
    const id = anApplication(h)
    okOr(add(h, id, 'Order an official transcript'))
    const again = add(h, id, 'order an official transcript.')
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.errors[0]?.message).toMatch(/already on the list/)
    expect(listOf(h, id)).toHaveLength(1)
  })

  it('refuses past the cap, in the same words the disabled control uses', () => {
    const h = harness()
    const id = anApplication(h)
    for (let i = 0; i < MAX_CHECKLIST_ITEMS; i += 1) okOr(add(h, id, `step ${String(i)}`))
    const over = add(h, id, 'one more')
    expect(over.ok).toBe(false)
    if (!over.ok) expect(over.errors[0]?.message).toMatch(/most one application holds/)
    expect(listOf(h, id)).toHaveLength(MAX_CHECKLIST_ITEMS)
  })

  it('fails readably against an application that is not there', () => {
    const h = harness()
    const missing = h.runtime.run('application.checklist.item.add', {
      id: 'app:0199aaaa-0000-7000-8000-000000000000',
      text: 'anything',
    })
    expect(missing.ok).toBe(false)
  })
})

describe('what a drafting run may and may not do', () => {
  it('ADDS to a list somebody is working through, and never replaces it', () => {
    const h = harness()
    const id = anApplication(h)
    okOr(add(h, id, 'My own step'))
    const itemId = listOf(h, id)[0]?.id
    if (itemId === undefined) throw new Error('the fixture added no step')
    okOr(h.runtime.run('application.checklist.item.set', { id, itemId, done: true }))

    okOr(
      h.runtime.run('application.checklist.draft.add', {
        id,
        items: [{ text: 'Order a transcript' }, { text: 'Draft the research statement' }],
        model: 'gemma_4_31b',
      }),
    )

    const list = listOf(h, id)
    expect(list.map((i) => i.text)).toEqual([
      'My own step',
      'Order a transcript',
      'Draft the research statement',
    ])
    // The person's tick is untouched, and unreachable from a model: no tool a
    // draft can call writes `doneOn`.
    expect(list[0]?.doneOn).toBeDefined()
    expect(list[1]?.doneOn).toBeUndefined()
  })

  it('writes nothing when the model repeats a list that is already there', () => {
    const h = harness()
    const id = anApplication(h)
    okOr(add(h, id, 'Order a transcript'))
    const before = h.repo.getSnapshot().node(id as never, 'application')?.updatedAt

    const again = okOr(
      h.runtime.run('application.checklist.draft.add', {
        id,
        items: [{ text: 'order a transcript' }],
        model: 'gemma_4_31b',
      }),
    )
    expect(again).toBe(0)
    // Not even `updatedAt`: a no-op patch takes the top of the undo stack and
    // poisons every "has this record moved since" check.
    expect(h.repo.getSnapshot().node(id as never, 'application')?.updatedAt).toBe(before)
  })

  it('stops at the cap rather than refusing the whole batch', () => {
    const h = harness()
    const id = anApplication(h)
    for (let i = 0; i < MAX_CHECKLIST_ITEMS - 1; i += 1) okOr(add(h, id, `step ${String(i)}`))
    const added = okOr(
      h.runtime.run('application.checklist.draft.add', {
        id,
        items: [{ text: 'first past the post' }, { text: 'second past the post' }],
        model: 'gemma_4_31b',
      }),
    )
    expect(added).toBe(1)
    expect(listOf(h, id)).toHaveLength(MAX_CHECKLIST_ITEMS)
  })
})

describe('changing and removing', () => {
  it('does nothing, and writes nothing, for a step that is not there', () => {
    const h = harness()
    const id = anApplication(h)
    okOr(add(h, id, 'Order a transcript'))
    const before = h.repo.getSnapshot().node(id as never, 'application')?.updatedAt

    okOr(h.runtime.run('application.checklist.item.set', { id, itemId: 'nope', done: true }))
    okOr(h.runtime.run('application.checklist.item.remove', { id, itemId: 'nope' }))
    expect(h.repo.getSnapshot().node(id as never, 'application')?.updatedAt).toBe(before)
  })

  it('does not restamp a step that is already ticked', () => {
    const h = harness()
    const id = anApplication(h)
    okOr(add(h, id, 'Order a transcript'))
    const itemId = listOf(h, id)[0]?.id
    if (itemId === undefined) throw new Error('the fixture added no step')
    okOr(h.runtime.run('application.checklist.item.set', { id, itemId, done: true }))
    const first = listOf(h, id)[0]?.doneOn
    okOr(h.runtime.run('application.checklist.item.set', { id, itemId, done: true }))
    expect(listOf(h, id)[0]?.doneOn).toBe(first)
  })

  it('unticking leaves no key behind', () => {
    const h = harness()
    const id = anApplication(h)
    okOr(add(h, id, 'Order a transcript'))
    const itemId = listOf(h, id)[0]?.id
    if (itemId === undefined) throw new Error('the fixture added no step')
    okOr(h.runtime.run('application.checklist.item.set', { id, itemId, done: true }))
    okOr(h.runtime.run('application.checklist.item.set', { id, itemId, done: false }))
    expect(Object.hasOwn(listOf(h, id)[0] ?? {}, 'doneOn')).toBe(false)
  })
})

describe('what a background pipeline may propose', () => {
  it('is none of these — a timer does not write somebody a to-do list', () => {
    for (const name of [
      'application.checklist.draft.add',
      'application.checklist.item.add',
      'application.checklist.item.set',
      'application.checklist.item.remove',
    ]) {
      expect(mayPropose('twin', name), name).toBe(false)
      expect(mayPropose('scout', name), name).toBe(false)
    }
  })

  it('marks only the delete destructive, and none of them system', () => {
    expect(TOOLS['application.checklist.item.remove'].effect).toBe('delete')
    // `draft.add` is NOT system: a person pressed Draft, so ⌘Z takes it back.
    expect(TOOLS['application.checklist.draft.add'].system).toBeUndefined()
    expect(TOOLS['application.checklist.draft.add'].internal).toBe(true)
  })
})
