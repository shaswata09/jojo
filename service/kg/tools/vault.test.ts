/**
 * The Vault's people, against a real repository: the refusals and the gate.
 *
 * R11c — taking someone off a job they are not on used to succeed.
 * R12 — a filing that drops a brief or a role is asked about; a role on a
 * create files the person where it names.
 */
import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import { createToolRuntime } from './runtime'
import { TOOLS } from './index'
import type { NodeId } from '../core/model'

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

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}



type H = ReturnType<typeof harness>
const run = (h: H, name: string, input: unknown) =>
  okOr(h.runtime.run(name as never, input as never)) as unknown as NodeId
const app = (h: H, org: string) => run(h, 'application.create', { org, role: 'Asst Prof', roleTag: 'Academic', stage: 'draft' })
const filedOn = (h: H, person: NodeId) => h.repo.getSnapshot().out(person, 'FILED_UNDER').map((e) => e.to).sort()

describe('vault.person.unfile', () => {
  it('refuses a job the person is not named on, and an application that is not there', () => {
    const h = harness()
    const rice = app(h, 'Rice')
    const baylor = app(h, 'Baylor')
    const person = run(h, 'vault.person.create', { name: 'Anita', applicationIds: [rice] })
    expect(h.runtime.run('vault.person.unfile', { id: person, applicationId: baylor }).ok).toBe(false)
    expect(h.runtime.run('vault.person.unfile', { id: person, applicationId: 'application:nope' as NodeId }).ok).toBe(false)
    expect(filedOn(h, person)).toEqual([rice])
    okOr(h.runtime.run('vault.person.unfile', { id: person, applicationId: rice }))
    expect(filedOn(h, person)).toEqual([])
  })
})

describe('vault.person.create', () => {
  it('files the person where each role names, without repeating it in applicationIds', () => {
    const h = harness()
    const rice = app(h, 'Rice')
    const person = run(h, 'vault.person.create', { name: 'Anita', roles: [{ applicationId: rice, role: 'recommender' }] })
    const edge = h.repo.getSnapshot().out(person, 'FILED_UNDER')
    expect(edge.map((e) => e.to)).toEqual([rice])
    expect((edge[0]?.props as { role?: string } | undefined)?.role).toBe('recommender')
  })

  it('files nowhere when given neither', () => {
    const h = harness()
    app(h, 'Rice')
    expect(filedOn(h, run(h, 'vault.person.create', { name: 'Bo' }))).toEqual([])
  })
})

describe('vault.person.update asks before a filing drops a brief or a role', () => {
  function briefed() {
    const h = harness()
    const rice = app(h, 'Rice')
    const baylor = app(h, 'Baylor')
    const ut = app(h, 'UT')
    const person = run(h, 'vault.person.create', {
      name: 'Anita',
      applicationIds: [rice, baylor, ut],
      roles: [{ applicationId: baylor, role: 'contact' }],
    })
    run(h, 'vault.person.update', { id: person, briefs: [{ applicationId: rice, note: 'Stress the grant' }] })
    // The predicate the agent's gate asks (`needsConfirming` in agent/catalog).
    const confirms = TOOLS['vault.person.update'].confirms
    if (!confirms) throw new Error('vault.person.update declares no confirms')
    const asks = (input: unknown) => confirms.when(input as never, h.repo.getSnapshot())
    return { h, rice, baylor, ut, person, asks }
  }

  it('asks when the filing drops a briefed job or a job with a role', () => {
    const b = briefed()
    expect(b.asks({ id: b.person, phone: '555-0100', applicationIds: [] })).toBe(true)
    expect(b.asks({ id: b.person, applicationIds: null })).toBe(true)
    expect(b.asks({ id: b.person, applicationIds: [b.baylor, b.ut] })).toBe(true) // drops Rice's brief
    expect(b.asks({ id: b.person, applicationIds: [b.rice, b.ut] })).toBe(true) // drops Baylor's role
  })

  it('does not ask when nothing written down is dropped', () => {
    const b = briefed()
    expect(b.asks({ id: b.person, phone: '555-0100' })).toBe(false)
    expect(b.asks({ id: b.person, applicationIds: [b.rice, b.baylor] })).toBe(false) // drops only UT, bare
    expect(b.asks({ id: b.person, applicationIds: [b.rice, b.baylor, b.ut] })).toBe(false)
  })

  it('says the filing is the whole set', () => {
    expect(TOOLS['vault.person.update'].summary).toContain('replaces the whole filing')
  })
})
