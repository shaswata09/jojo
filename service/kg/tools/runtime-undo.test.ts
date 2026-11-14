/**
 * Undo against a graph that has moved on, through the real repository and
 * runtime.
 *
 * Every case here was a reproduced review finding. The common shape: a revert
 * used to replay WHOLE record images, so anything written to the same record
 * after the entry — a system write kept off the undo ring, or a later agent
 * step — was erased by ⌘Z, ⇧⌘Z, or a step's own Undo.
 */

import { describe, expect, it } from 'vitest'
import type { NodeId } from '../core/model'
import { runsOf } from '../core/note-format'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'

const NOW = '2026-08-25T09:00:00.000Z'

/** The durable op as far as these checks read it; tools may not import storage. */
type Op = { kind: string; store: string; key: string | null }

function world() {
  const ops: Op[] = []
  const driver = {
    open: async () => ({ ok: true as const, value: { version: 1, from: 0, migrated: [], crossTab: false } }),
    readAll: async () => ({ ok: true as const, value: { nodes: [], edges: [], meta: [], ops: [] } }),
    commit: async (batch: readonly Op[]) => {
      ops.push(...batch)
      return { ok: true as const, value: undefined }
    },
    replace: async () => ({ ok: true as const, value: undefined }),
    seedIfPristine: async () => ({ ok: true as const, value: true }),
    destroy: async () => ({ ok: true as const, value: undefined }),
    onRemoteCommit: () => () => {},
    onBlocking: () => () => {},
    close: () => {},
  }
  let tick = 0
  const now = () => new Date(Date.parse(NOW) + tick++ * 1000).toISOString()
  const repo = createRepository({
    driver: driver as unknown as Parameters<typeof createRepository>[0]['driver'],
    snapshot: new MutableSnapshot(),
    meta: { schemaVersion: 1, createdAt: NOW, lastOpenedAt: NOW, dataSet: 'user', seededAt: null, handoverAt: null },
    now,
  })
  const runtime = createToolRuntime({ repo, now })
  const run = (name: string, input: unknown) => {
    const out = runtime.run(name as never, input as never)
    if (!out.ok) throw new Error(out.errors.map((e) => e.message).join('; '))
    return out
  }
  const app = () =>
    run('application.create', { org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'draft' })
      .output as NodeId
  const file = () =>
    (
      run('vault.file.add', {
        files: [{ name: 'posting.pdf', kind: 'pdf', bucket: 'To read', size: '1 KB' }],
      }).output as NodeId[]
    )[0]!
  const reading = (fileId: NodeId) =>
    run('fit.reading.set', { fileId, requirements: [{ text: 'PhD', essential: true }], model: 'm' })
  return { repo, runtime, run, app, file, reading, ops, node: (id: NodeId) => repo.getSnapshot().node(id),
    /** Read loosely: these checks span four record types. */
    props: (id: NodeId) => (repo.getSnapshot().node(id)?.props ?? {}) as Record<string, unknown>,
  }
}

describe('a revert keeps what was written after the entry', () => {
  it('⌘Z of a note keeps the fit reading stored on the same file since', () => {
    const w = world()
    const f = w.file()
    w.run('vault.file.note.set', { id: f, note: 'edit' })
    w.reading(f)
    // The reading is a system write: off the ring, so ⌘Z reaches the note.
    expect(w.repo.undoable[0]?.label).toBe('Note saved')

    w.runtime.undo()

    expect(w.node(f)?.props).toMatchObject({ reading: expect.anything() })
    expect(w.node(f)?.props).not.toHaveProperty('note')
  })

  it('⇧⌘Z of a note keeps a reading that landed between the undo and the redo', () => {
    const w = world()
    const f = w.file()
    w.run('vault.file.note.set', { id: f, note: 'edit' })
    w.runtime.undo()
    w.reading(f)
    expect(w.repo.redoable).toHaveLength(1)

    w.runtime.redo()

    expect(w.node(f)?.props).toMatchObject({ note: 'edit', reading: expect.anything() })
  })

  it('still puts an untouched record back byte for byte', () => {
    const w = world()
    const id = w.app()
    const before = structuredClone(w.node(id))
    w.run('application.note.set', { id, note: 'first note' })
    w.runtime.undo()
    expect(w.node(id)).toStrictEqual(before)
  })
})

describe("a step's own Undo", () => {
  it('takes back that step and leaves a later step standing', () => {
    const w = world()
    const id = w.app()
    const note = w.run('application.note.set', { id, note: 'first note' })
    w.run('application.update', { id, stage: 'submitted' })

    note.undo?.()

    // Was 'draft' and '' — the note's whole before-image landed over the move.
    expect(w.node(id)?.props).toMatchObject({ stage: 'submitted' })
    expect(w.props(id)['note'] ?? '').toBe('')
  })

  it('does nothing the second time, rather than undoing its own undo', () => {
    const w = world()
    const id = w.app()
    const note = w.run('application.note.set', { id, note: 'first note' })
    note.undo?.()
    const audited = w.repo.audit.length
    note.undo?.()
    expect(w.props(id)['note'] ?? '').toBe('')
    // Not a second revert out of the audit ring, which would also have
    // cleared the redo the first press offered.
    expect(w.repo.audit.length).toBe(audited)
    expect(w.repo.redoable).toHaveLength(1)
  })

  it('follows the step through ⌘Z and ⇧⌘Z', () => {
    const w = world()
    const id = w.app()
    const note = w.run('application.note.set', { id, note: 'first note' })
    w.runtime.undo()
    w.runtime.redo()
    expect(w.props(id)['note']).toBe('first note')

    note.undo?.()

    expect(w.props(id)['note'] ?? '').toBe('')
  })

  it('never puts back an edge whose other end has since been deleted', async () => {
    const w = world()
    const app = w.app()
    const person = w.run('vault.person.create', { name: 'Ann', applicationIds: [app] }).output as NodeId
    const gone = w.run('vault.person.delete', { id: person })
    w.run('application.delete', { id: app })

    gone.undo?.()

    const s = w.repo.getSnapshot()
    expect(s.node(person)).toBeDefined()
    for (const e of s.edges()) {
      expect(s.node(e.from)).toBeDefined()
      expect(s.node(e.to)).toBeDefined()
    }
    await w.repo.flush()
    const puts = w.ops.filter((o) => o.store === 'edges' && o.kind === 'put')
    expect(puts.filter((o) => o.key?.includes(app))).toEqual([])
  })
})

describe('the journal', () => {
  it('names an undo as an undo, and the ⌘Z toast still names the action', () => {
    const w = world()
    w.app()
    const undone = w.runtime.undo()
    expect(w.repo.audit.map((e) => e.label)).toEqual(['Undo Rice — AP added', 'Rice — AP added'])
    expect(undone.ok && undone.announcement.description).toBe('Rice — AP added')

    const redone = w.runtime.redo()
    expect(w.repo.audit[0]?.label).toBe('Redo Rice — AP added')
    expect(redone.ok && redone.announcement.description).toBe('Rice — AP added')
  })

  it('keeps no transcript images for a thread save, which nothing can undo', async () => {
    const w = world()
    const id = w.run('assistant.thread.create', { title: 't' }).output as NodeId
    const entries: { kind: string; text: string }[] = []
    for (let i = 0; i < 40; i += 1) {
      entries.push({ kind: 'you', text: 'q'.repeat(300) }, { kind: 'agent', text: 'a'.repeat(1500) })
      w.run('assistant.thread.set', { id, entries: [...entries] })
    }
    await w.repo.flush()
    const thread = JSON.stringify(w.node(id)).length
    const journal = JSON.stringify(w.ops.filter((o) => o.store === 'ops')).length
    // Was ~70x the record: before AND after of the whole transcript, per save.
    expect(journal).toBeLessThan(thread)
    expect(w.props(id)['entries']).toHaveLength(80)
  })
})

describe('the runtime', () => {
  it('refuses a tool name the registry does not hold, rather than throwing a TypeError', () => {
    const w = world()
    const out = w.runtime.run('application.renamedAway' as never, {} as never)
    expect(out.ok).toBe(false)
    expect(w.runtime.run('toString' as never, {} as never).ok).toBe(false)
  })
})

describe('writes that change nothing, and text that changes under its formatting', () => {
  it('an unchanged application form takes no undo slot and keeps its activity', () => {
    const w = world()
    const id = w.app()
    w.run('application.note.set', { id, note: 'real edit' })
    const ring = w.repo.undoable.length
    const activity = w.props(id)['lastActionAt']

    w.run('application.update', { id, org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'draft', note: 'real edit' })

    expect(w.repo.undoable.length).toBe(ring)
    expect(w.props(id)['lastActionAt']).toBe(activity)
  })

  it('a real change to the form still counts as activity', () => {
    const w = world()
    const id = w.app()
    const activity = w.props(id)['lastActionAt']
    w.run('application.update', { id, role: 'Associate professor' })
    expect(w.props(id)['lastActionAt']).not.toBe(activity)
    expect(w.props(id)['lastAction']).toBe('Details edited')
  })

  it("a file's note.set moves its formatting with the text", () => {
    const w = world()
    const f = w.file()
    w.run('vault.file.update', { id: f, note: 'URGENT send by Friday', noteFormat: '0-6:b::' })
    w.run('vault.file.note.set', { id: f, note: 'Note: URGENT send by Friday' })
    const p = w.props(f) as { note: string; noteFormat?: never }
    expect(runsOf(p.note, p.noteFormat).filter((r) => r.bold).map((r) => r.text)).toEqual(['URGENT'])
  })

  it('a duplicated tailored snippet keeps its bold on the same words', () => {
    const w = world()
    const app = w.app()
    const id = w.run('tailor.snippet.create', {
      applicationId: app,
      source: 'x',
      kind: 'cv',
      model: 'm',
      title: 'CV',
      tag: 'Email',
      body: '## Summary\n**Expert** in ML systems',
    }).output as NodeId
    const body = w.props(id)['body'] as string
    const at = body.indexOf('ML')
    w.run('vault.snippet.update', { id, format: `${String(at)}-${String(at + 2)}:b::` })

    const copy = w.run('vault.snippet.duplicate', { id }).output as NodeId

    const p = w.props(copy) as { body: string; bodyFormat?: never }
    expect(runsOf(p.body, p.bodyFormat).filter((r) => r.bold).map((r) => r.text)).toEqual(['ML'])
  })
})

/* Round-2 review findings (R10a–e, R13), each reproduced before it was fixed. */

describe('a revert that would reach past a later write', () => {
  it("R10a: a step's Undo of the first job at an employer keeps the employer a later job is at", () => {
    const w = world()
    const first = w.run('application.create', { org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'draft' })
    const second = w.app()
    const s = () => w.repo.getSnapshot()
    const org = s().one(second, 'AT', 'organisation')
    expect(org).toBeDefined()

    first.undo?.()

    expect(s().node(first.output as NodeId)).toBeUndefined()
    // Was 0: the org went with the first job and took the second job's AT edge.
    expect(s().out(second, 'AT').map((e) => e.to)).toEqual([org!.id])
    expect(s().in(org!.id, 'AT')).toHaveLength(1)
  })

  it('R10a: ⌘Z of a move to a new employer takes that employer back and restores the old one', () => {
    const w = world()
    const id = w.app()
    const rice = w.repo.getSnapshot().one(id, 'AT', 'organisation')!
    w.run('application.update', { id, org: 'MIT' })
    w.runtime.undo()
    const s = w.repo.getSnapshot()
    expect(s.one(id, 'AT', 'organisation')?.id).toBe(rice.id)
    expect(s.ofType('organisation').map((o) => o.props.name)).toEqual(['Rice'])
  })

  it('R10a: a job something now copies stays, whole, employer, deadline and all', () => {
    const w = world()
    const create = w.run('application.create', {
      org: 'Rice',
      role: 'AP',
      roleTag: 'Faculty',
      stage: 'draft',
      deadline: '2026-09-30',
    })
    const id = create.output as NodeId
    const deadline = w.repo.getSnapshot().many(id, 'ABOUT', 'in', 'timelineItem')[0]!
    const copy = w.run('application.duplicate', { id }).output as NodeId

    const outcome = create.undo?.()

    const s = w.repo.getSnapshot()
    expect(s.node(id)).toBeDefined()
    expect(s.one(id, 'AT', 'organisation')?.props.name).toBe('Rice')
    expect(s.one(copy, 'COPY_OF', 'application')?.id).toBe(id)
    // Was deleted: the job stayed and the deadline its form stood up for it
    // went, so the calendar lost the item while the toast said Undone.
    expect(s.many(id, 'ABOUT', 'in', 'timelineItem').map((i) => i.id)).toEqual([deadline.id])
    // Everything the entry made is still needed, so nothing was taken back.
    expect(outcome).toBe('nothing')
    expect(w.repo.redoable).toHaveLength(0)
  })

  it('R10a: tagging a new job does not pin it — its Undo still takes it back', () => {
    const w = world()
    const create = w.run('application.create', { org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'draft' })
    const id = create.output as NodeId
    const other = w.app()
    const kw = w.run('keyword.create', { name: 'ml' }).output as NodeId
    w.run('keyword.record.set', { record: id, keywords: [kw] })

    create.undo?.()

    const s = w.repo.getSnapshot()
    expect(s.node(id)).toBeUndefined()
    expect(s.node(kw)).toBeDefined()
    expect(s.one(other, 'AT', 'organisation')?.props.name).toBe('Rice')
  })

  it('R10a: still takes the employer back when nothing else is at it', () => {
    const w = world()
    w.app()
    w.runtime.undo()
    expect(w.repo.getSnapshot().ofType('organisation')).toEqual([])
    expect(w.repo.getSnapshot().ofType('application')).toEqual([])
  })

  it('R10b: never splits a stage move — Interview keeps the submitted date its first move stamped', () => {
    const w = world()
    const id = w.app()
    const submitted = w.run('application.update', { id, stage: 'submitted' })
    const on = w.props(id)['submittedOn']
    expect(on).toBeDefined()
    w.run('application.update', { id, stage: 'interview' })

    submitted.undo?.()

    // Was stage 'interview' with no submittedOn: the stage had moved on, so it
    // stayed, while the date it was moved with went back on its own.
    expect(w.props(id)).toMatchObject({ stage: 'interview', submittedOn: on })
  })

  it('R10b: a later correction to one date of the move pins the whole move', () => {
    const w = world()
    const id = w.app()
    const move = w.run('application.update', { id, stage: 'submitted' })
    w.run('application.update', { id, submittedOn: '2026-08-01' })

    move.undo?.()

    expect(w.props(id)).toMatchObject({ stage: 'submitted', submittedOn: '2026-08-01' })
  })

  it('R10b: a stage move with nothing after it still comes back whole', () => {
    const w = world()
    const id = w.app()
    const before = structuredClone(w.props(id))
    w.run('application.update', { id, stage: 'submitted' })
    w.run('application.note.set', { id, note: 'later note' })
    const move = w.repo.undoable[1]!
    w.repo.revert(move.id)
    expect(w.props(id)['stage']).toBe('draft')
    expect(w.props(id)['submittedOn']).toBe(before['submittedOn'])
    expect(w.props(id)['note']).toBe('later note')
  })

  it("R10c: a step's Undo of a delete never brings a claim back with one end", () => {
    const w = world()
    const { ids } = w.run('profile.background.add', {
      background: [
        { kind: 'skill', title: 'Rust' },
        { kind: 'employment', title: 'Engineer', where: 'Acme' },
      ],
    }).output as { ids: NodeId[] }
    const [a, b] = ids as [NodeId, NodeId]
    const claim = w.run('claim.add', { subject: a, predicate: 'used in', object: b }).output as NodeId
    const delA = w.run('profile.background.delete', { id: a })
    w.run('profile.background.delete', { id: b })

    delA.undo?.()

    const s = w.repo.getSnapshot()
    expect(s.node(a)).toBeDefined()
    // Was back with SUBJECT and no OBJECT: half a fact nothing can show or delete.
    expect(s.node(claim)).toBeUndefined()
    for (const e of s.edges()) {
      expect(s.node(e.from)).toBeDefined()
      expect(s.node(e.to)).toBeDefined()
    }
  })
})

describe('an undo with nothing left to take back', () => {
  it('R10d: says so, leaves the ring, and offers no redo', () => {
    const w = world()
    const f = w.file()
    const read = (t: string) =>
      w.run('fit.reading.set', { fileId: f, requirements: [{ text: t, essential: true }], model: 'm' })
    read('PhD')
    w.run('fit.reading.clear', { fileId: f })
    read('MSc')
    const audited = w.repo.audit.length
    const top = w.repo.undoable[0]!.id

    const out = w.runtime.undo()

    expect(out.ok).toBe(false)
    expect(!out.ok && out.errors[0]?.message).toMatch(/Nothing to undo/)
    expect(w.repo.undoable.some((e) => e.id === top)).toBe(false)
    expect(w.repo.redoable).toHaveLength(0)
    expect(w.repo.audit.length).toBe(audited)
    expect(JSON.stringify(w.props(f)['reading'])).toContain('MSc')
  })
})

describe("a step's Undo after the audit ring has turned over", () => {
  it('R10e: still finds the step through ⌘Z/⇧⌘Z after 200 system writes', () => {
    const w = world()
    const id = w.app()
    const f = w.file()
    const step = w.run('application.note.set', { id, note: 'agent note' })
    w.runtime.undo()
    w.runtime.redo()
    for (let i = 0; i < 205; i += 1) {
      w.run('fit.reading.set', { fileId: f, requirements: [{ text: `R${String(i)}`, essential: true }], model: 'm' })
    }

    step.undo?.()

    expect(w.props(id)['note'] ?? '').toBe('')
  })
})

describe('application.delete', () => {
  it('R13: takes its own deadline and an employer left with no jobs, and Undo brings both back', () => {
    const w = world()
    const id = w.run('application.create', {
      org: 'Rice University',
      role: 'AP',
      roleTag: 'Faculty',
      stage: 'draft',
      deadline: '2026-08-28',
    }).output as NodeId
    const other = w.run('timeline.item.create', {
      title: 'Call Ann',
      date: '2026-08-29',
      kind: 'call',
      applicationIds: [id],
    }).output as NodeId
    const s = () => w.repo.getSnapshot()
    const deadline = s().many(id, 'ABOUT', 'in', 'timelineItem').find((i) => i.id !== other)!
    const org = s().one(id, 'AT', 'organisation')!

    w.run('application.delete', { id })

    expect(s().node(deadline.id)).toBeUndefined()
    expect(s().node(org.id)).toBeUndefined()
    // Every other item stays, unlinked (D15).
    expect(s().node(other)).toBeDefined()

    w.runtime.undo()

    expect(s().node(id)).toBeDefined()
    expect(s().node(deadline.id)).toBeDefined()
    expect(s().one(id, 'AT', 'organisation')?.id).toBe(org.id)
  })

  it('R13: keeps an employer another job is still at', () => {
    const w = world()
    const id = w.app()
    const second = w.app()
    const org = w.repo.getSnapshot().one(id, 'AT', 'organisation')!
    w.run('application.delete', { id })
    expect(w.repo.getSnapshot().one(second, 'AT', 'organisation')?.id).toBe(org.id)
  })
})

describe('R3: deletes undone out of order', () => {
  const deleteBoth = (w: ReturnType<typeof world>) => {
    const first = w.run('application.create', {
      org: 'Rice',
      role: 'AP',
      roleTag: 'Faculty',
      stage: 'draft',
      deadline: '2026-09-30',
    }).output as NodeId
    const second = w.run('application.create', { org: 'Rice', role: 'Lecturer', roleTag: 'Faculty', stage: 'draft' })
      .output as NodeId
    const org = w.repo.getSnapshot().one(first, 'AT', 'organisation')!
    const d1 = w.run('application.delete', { id: first })
    w.run('application.delete', { id: second })
    // The second delete took the employer: nothing was left at it.
    expect(w.repo.getSnapshot().node(org.id)).toBeUndefined()
    return { first, second, org, d1 }
  }

  it("a step's Undo of the first brings its employer back, and ⌘Z of the second shares it", () => {
    const w = world()
    const { first, second, org, d1 } = deleteBoth(w)

    expect(d1.undo?.()).toBe('undone')

    const s = () => w.repo.getSnapshot()
    // Was '(none)': the first delete never held the org, so its AT edge was
    // dropped as dangling and no later revert put it back.
    expect(s().one(first, 'AT', 'organisation')?.id).toBe(org.id)
    expect(s().ofType('organisation')).toHaveLength(1)

    w.runtime.undo()

    expect(s().one(second, 'AT', 'organisation')?.id).toBe(org.id)
    expect(s().one(first, 'AT', 'organisation')?.id).toBe(org.id)
    expect(s().ofType('organisation')).toHaveLength(1)
  })

  it('a redo of that Undo takes the job back and the employer with it, as the delete did', () => {
    const w = world()
    const { first, org, d1 } = deleteBoth(w)
    d1.undo?.()

    w.runtime.redo()

    expect(w.repo.getSnapshot().node(first)).toBeUndefined()
    expect(w.repo.getSnapshot().node(org.id)).toBeUndefined()
  })

  it('a claim deleted with one end comes back with the revert that restores the other', () => {
    const w = world()
    const ann = w.run('vault.person.create', { name: 'Ann' }).output as NodeId
    const bob = w.run('vault.person.create', { name: 'Bob' }).output as NodeId
    const claim = w.run('claim.add', { subject: ann, predicate: 'supervised', object: bob }).output as NodeId
    const delAnn = w.run('vault.person.delete', { id: ann })
    w.run('vault.person.delete', { id: bob })

    delAnn.undo?.()
    // Half a claim is never put back (R10c).
    expect(w.repo.getSnapshot().node(claim)).toBeUndefined()

    w.runtime.undo()

    // Was lost for good: Bob's delete never held the claim.
    const s = w.repo.getSnapshot()
    expect(s.node(claim)).toBeDefined()
    expect(s.one(claim, 'SUBJECT', 'person')?.id).toBe(ann)
    expect(s.one(claim, 'OBJECT', 'person')?.id).toBe(bob)

    // And a redo of Bob's restore takes the claim away with him again.
    w.runtime.redo()
    expect(w.repo.getSnapshot().node(bob)).toBeUndefined()
    expect(w.repo.getSnapshot().node(claim)).toBeUndefined()
    for (const e of w.repo.getSnapshot().edges()) {
      expect(w.repo.getSnapshot().node(e.from)).toBeDefined()
      expect(w.repo.getSnapshot().node(e.to)).toBeDefined()
    }
  })
})

describe('R3: an Undo after the employer was stood up again', () => {
  it('re-points the job at the live employer rather than restoring a second one', () => {
    const w = world()
    const first = w.app()
    const del = w.run('application.delete', { id: first })
    const second = w.app()
    const live = w.repo.getSnapshot().one(second, 'AT', 'organisation')!

    del.undo?.()

    const s = w.repo.getSnapshot()
    // Was two organisations named Rice, on two graph nodes.
    expect(s.ofType('organisation').map((o) => o.id)).toEqual([live.id])
    expect(s.one(first, 'AT', 'organisation')?.id).toBe(live.id)
    for (const e of s.edges()) {
      expect(s.node(e.from)).toBeDefined()
      expect(s.node(e.to)).toBeDefined()
    }

    // ⇧⌘Z takes the job back and leaves the employer the other job is at.
    w.runtime.redo()
    expect(w.repo.getSnapshot().node(first)).toBeUndefined()
    expect(w.repo.getSnapshot().one(second, 'AT', 'organisation')?.id).toBe(live.id)
  })
})

describe('R3: the stage group', () => {
  it('pins a move to Offer once the offer is edited, rather than keeping an offer at Interview', () => {
    const w = world()
    const id = w.run('application.create', { org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'interview' })
      .output as NodeId
    const move = w.run('application.stage.advance', {
      id,
      stage: 'offer',
      offer: { respondBy: '2026-09-10', note: 'x' },
    })
    w.run('application.update', { id, offer: { respondBy: '2026-09-12', note: 'y' } })

    expect(move.undo?.()).toBe('nothing')

    expect(w.props(id)).toMatchObject({ stage: 'offer', offer: { respondBy: '2026-09-12', note: 'y' } })
  })

  it('pins a close once its outcome is edited, rather than reopening with a closing outcome', () => {
    const w = world()
    const id = w.run('application.create', { org: 'Rice', role: 'AP', roleTag: 'Faculty', stage: 'interview' })
      .output as NodeId
    const close = w.run('application.stage.advance', { id, stage: 'closed', outcome: 'rejected' })
    w.run('application.update', { id, outcome: 'withdrawn' })

    expect(close.undo?.()).toBe('nothing')

    expect(w.props(id)).toMatchObject({ stage: 'closed', outcome: 'withdrawn' })
  })

  it('pins a move to Submitted once a reply date is added', () => {
    const w = world()
    const id = w.app()
    const move = w.run('application.stage.advance', { id, stage: 'submitted', submittedOn: '2026-08-20' })
    w.run('application.update', { id, firstReplyOn: '2026-08-24' })

    expect(move.undo?.()).toBe('nothing')

    expect(w.props(id)).toMatchObject({ stage: 'submitted', submittedOn: '2026-08-20', firstReplyOn: '2026-08-24' })
  })
})

describe("R3: what a step's Undo says it did", () => {
  it('says undone, then already undone, and a ⌘Z-undone step says the same', () => {
    const w = world()
    const id = w.app()
    const note = w.run('application.note.set', { id, note: 'first note' })
    expect(note.undo?.()).toBe('undone')
    expect(note.undo?.()).toBe('already-undone')

    const again = w.run('application.note.set', { id, note: 'second note' })
    w.runtime.undo()
    expect(again.undo?.()).toBe('already-undone')
    // ⇧⌘Z puts it back, so the step can be taken back again.
    w.runtime.redo()
    expect(again.undo?.()).toBe('undone')
  })

  it('says out of reach once the step has aged off the undo ring', () => {
    const w = world()
    const id = w.app()
    const note = w.run('application.note.set', { id, note: 'first note' })
    for (let i = 0; i < 55; i += 1) w.run('application.note.set', { id, note: `note ${String(i)}` })

    expect(note.undo?.()).toBe('out-of-reach')
  })
})
