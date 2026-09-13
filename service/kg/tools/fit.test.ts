/**
 * The two writes that make a fit reading survive a reload, against a real
 * repository.
 *
 * What this is about: the fit panel used to hold its requirement list in a
 * module Map, so every refresh re-read the posting and spent a model call
 * arriving back at the answer it already had. The list is stored now, and these
 * are the two halves of that — recording one, and throwing one away.
 *
 * The assertions that matter are not "the field was written". They are:
 *
 *   - Clearing does NOT delete the reading. A cleared row that vanished would
 *     be indistinguishable from a document nobody has read, and the panel reads
 *     an unread document automatically — so Clear would empty the card and the
 *     verdict would come straight back on the next render.
 *   - An empty requirement list is NOT a clear. A posting can genuinely state
 *     nothing measurable, and `assess` has an honest answer for it.
 *   - Undo puts the reading back byte-identically, because a clear is a person
 *     being able to change their mind (D12).
 *   - The write is not on the undo ring. Nobody presses "read this posting";
 *     opening the record does it, and ⌘Z has to stay pointed at the last thing
 *     the person actually did.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import type { NodeId } from '../core/model'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'

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

/** A saved posting, the only kind of file this pair of tools is ever used on. */
function aPosting(h: H): NodeId {
  const ids = okOr(
    h.runtime.run('vault.file.add', {
      files: [
        {
          name: 'Assistant Professor — CS.html',
          kind: 'page',
          bucket: 'Job postings',
          size: '184 KB',
          sourceUrl: 'https://jobs.example.edu/4012',
        },
      ],
    }),
  )
  const id = ids[0]
  if (id === undefined) throw new Error('vault.file.add returned no id.')
  return id
}

const readingOf = (h: H, id: NodeId) => h.repo.getSnapshot().node(id, 'file')?.props.reading

const REQUIREMENTS = [
  { text: 'PhD in computer science', essential: true },
  { text: 'distributed systems', essential: false },
]

describe('fit.reading.set', () => {
  it('stores what the model read, with the model that read it and when', () => {
    const h = harness()
    const id = aPosting(h)

    okOr(
      h.runtime.run('fit.reading.set', {
        fileId: id,
        requirements: REQUIREMENTS,
        model: 'gemma_4_31b',
      }),
    )

    const reading = readingOf(h, id)
    expect(reading?.requirements).toEqual(REQUIREMENTS)
    expect(reading?.model).toBe('gemma_4_31b')
    // From `ctx.now`, not a real clock.
    expect(reading?.readAt.startsWith('2026-10-12')).toBe(true)
    expect(reading?.clearedAt).toBeUndefined()
  })

  it('keeps a skipped count only when something was skipped', () => {
    const h = harness()
    const a = aPosting(h)
    okOr(
      h.runtime.run('fit.reading.set', {
        fileId: a,
        requirements: REQUIREMENTS,
        model: 'm',
        skipped: 4,
      }),
    )
    expect(readingOf(h, a)?.skipped).toBe(4)

    const b = aPosting(h)
    okOr(
      h.runtime.run('fit.reading.set', {
        fileId: b,
        requirements: REQUIREMENTS,
        model: 'm',
        skipped: 0,
      }),
    )
    // Zero is not news, and a key that is always present stops being read.
    expect(Object.hasOwn(readingOf(h, b) ?? {}, 'skipped')).toBe(false)
  })

  it('replaces a reading rather than merging with it', () => {
    // Re-run exists because somebody disbelieves the answer on screen. A merge
    // would keep the requirement they are rejecting.
    const h = harness()
    const id = aPosting(h)
    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm1' }))
    okOr(
      h.runtime.run('fit.reading.set', {
        fileId: id,
        requirements: [{ text: 'teaching experience', essential: true }],
        model: 'm2',
      }),
    )

    expect(readingOf(h, id)?.requirements).toEqual([
      { text: 'teaching experience', essential: true },
    ])
    expect(readingOf(h, id)?.model).toBe('m2')
  })

  it('takes a clear back, because a new reading answers the question a clear declined', () => {
    const h = harness()
    const id = aPosting(h)
    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm' }))
    okOr(h.runtime.run('fit.reading.clear', { fileId: id }))
    expect(readingOf(h, id)?.clearedAt).toBeDefined()

    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm' }))

    expect(readingOf(h, id)?.clearedAt).toBeUndefined()
    expect(readingOf(h, id)?.requirements).toEqual(REQUIREMENTS)
  })

  it('stays off the undo ring', () => {
    /*
     * `system: true`. Opening an application is what starts the read, so ⌘Z
     * after opening a record has to undo whatever the person last did — not
     * "the posting was read". Undoing it would also delete the stored reading
     * and the panel would immediately read the posting again.
     */
    const h = harness()
    const id = aPosting(h)
    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm' }))

    h.runtime.undo()

    // The reading survives, and what undo actually took back is the file.
    expect(h.repo.getSnapshot().node(id, 'file')).toBeUndefined()
  })

  it('refuses a posting that is not there', () => {
    const h = harness()
    const result = h.runtime.run('fit.reading.set', {
      fileId: 'file:0192-nope' as NodeId,
      requirements: REQUIREMENTS,
      model: 'm',
    })
    expect(result.ok).toBe(false)
  })

  it('refuses more requirements than a reader is allowed to return', () => {
    // The bound is on the schema as well as in the reader, because this prop is
    // also reachable from a restored backup.
    const h = harness()
    const id = aPosting(h)
    const many = Array.from({ length: 13 }, (_, i) => ({ text: `r${String(i)}`, essential: false }))
    expect(
      h.runtime.run('fit.reading.set', { fileId: id, requirements: many, model: 'm' }).ok,
    ).toBe(false)
  })
})

describe('fit.reading.clear', () => {
  it('empties the answer and marks it, rather than deleting the reading', () => {
    /*
     * THE assertion of this file. A cleared row that vanished would read as a
     * document nobody has looked at, and the panel reads one of those
     * automatically — so the card would empty and refill itself.
     */
    const h = harness()
    const id = aPosting(h)
    okOr(
      h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'gemma' }),
    )
    const before = readingOf(h, id)

    okOr(h.runtime.run('fit.reading.clear', { fileId: id }))

    const reading = readingOf(h, id)
    expect(reading).toBeDefined()
    expect(reading?.requirements).toEqual([])
    expect(reading?.clearedAt).toBeDefined()
    // What it was read by and WHEN survive, and the date is the original one.
    // Restamping `readAt` on a clear would record the reading as having happened
    // at the moment it was discarded, which is the one thing that is certainly
    // untrue — and it would put the two dates the row exists to hold, read and
    // cleared, at the same instant.
    expect(reading?.model).toBe('gemma')
    expect(reading?.readAt).toBe(before?.readAt)
    expect(reading?.readAt).not.toBe(reading?.clearedAt)
  })

  it('is undoable, byte for byte', () => {
    const h = harness()
    const id = aPosting(h)
    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm' }))
    const before = readingOf(h, id)

    okOr(h.runtime.run('fit.reading.clear', { fileId: id }))
    h.runtime.undo()

    expect(readingOf(h, id)).toEqual(before)
  })

  it('does nothing to a posting nobody has read, twice over', () => {
    /*
     * Idempotent and ungated, like the pipeline's two housekeeping verbs:
     * withholding the button on an empty card turns a second press into a
     * refusal about nothing.
     */
    const h = harness()
    const id = aPosting(h)

    expect(h.runtime.run('fit.reading.clear', { fileId: id }).ok).toBe(true)
    expect(readingOf(h, id)).toBeUndefined()

    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm' }))
    okOr(h.runtime.run('fit.reading.clear', { fileId: id }))
    const once = readingOf(h, id)
    okOr(h.runtime.run('fit.reading.clear', { fileId: id }))
    // The second clear must not restamp it: "cleared on the 12th" is a fact
    // about when the person decided, not about when they last pressed.
    expect(readingOf(h, id)).toEqual(once)
  })

  it('goes with the document when the document goes', () => {
    // Why the reading lives on the file at all: nothing has to remember to
    // clean it up, and there is no orphan to find later.
    const h = harness()
    const id = aPosting(h)
    okOr(h.runtime.run('fit.reading.set', { fileId: id, requirements: REQUIREMENTS, model: 'm' }))

    okOr(h.runtime.run('vault.file.delete', { id }))

    expect(h.repo.getSnapshot().node(id, 'file')).toBeUndefined()
  })
})
