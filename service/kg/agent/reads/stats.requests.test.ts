/**
 * Q190: the analytics tool's result carries no search-health axes.
 *
 * The owner said "drop 'health'". The six radar axes (Sent, Replies,
 * Interviews, Referrals, Follow-ups, Kept moving) stay on the Statistics page,
 * but `stats.report` leaves them out, which also keeps the payload under the
 * agent's result cap. This builds a store where every axis has something to
 * measure — sent, replied, referred, a late follow-up — so a health block, if
 * one came back, would be full rather than empty.
 */

import { describe, expect, it } from 'vitest'
import { applicationFrom } from '../../core/project'
import { searchHealthFor } from '../../core/statistics'
import { MutableSnapshot } from '../../core/snapshot'
import type { GraphSnapshot } from '../../core/snapshot'
import { createRepository } from '../../repo/repository'
import { createToolRuntime } from '../../tools/runtime'
import { statsReport } from './stats'

const START = Date.parse('2026-10-01T09:00:00.000Z')
const TODAY = '2026-10-12'

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

function measurableStore(): GraphSnapshot {
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
  const make = (over: Record<string, unknown>) =>
    runtime.runOrThrow('application.create', {
      org: 'Example',
      role: 'Engineer',
      roleTag: 'Industry',
      stage: 'submitted',
      ...(over['stage'] === 'draft' ? {} : { appliedOn: '2026-09-20' }),
      ...over,
    })
  for (let i = 0; i < 4; i += 1) make({ firstReplyOn: '2026-09-25', source: 'Referral' })
  for (let i = 0; i < 4; i += 1) make({ source: 'Job board' })
  make({ stage: 'interview', firstReplyOn: '2026-09-24' })
  make({ stage: 'draft' })
  runtime.runOrThrow('timeline.item.create', {
    title: 'Chase Example',
    date: '2026-10-05',
    kind: 'follow-up',
    remind: true,
    applicationIds: [],
  })
  return repo.getSnapshot() as GraphSnapshot
}

/** Every key at every depth of a JSON value. */
function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(keysOf)
  if (value === null || typeof value !== 'object') return []
  return Object.entries(value).flatMap(([k, v]) => [k, ...keysOf(v)])
}

describe('the stats.report payload (Q190)', () => {
  const memory = measurableStore()
  const payload = statsReport.read(memory, {}, { today: TODAY } as never)

  it('is built on a store whose health axes are all measurable', () => {
    // The precondition: if health were in the payload, it would have content.
    const applications = memory.ofType('application').map((n) => applicationFrom(n, memory, TODAY))
    const timeline = memory.ofType('timelineItem').map((n) => n.props) as never
    const axes = searchHealthFor({ applications, timeline, today: TODAY })
    expect(axes).toHaveLength(6)
    expect(axes.every((a) => a.score !== null)).toBe(true)
    expect(payload).toMatchObject({ sent: 9, tracked: 10 })
  })

  it('has no health key at any depth', () => {
    expect(keysOf(payload).filter((k) => /health/i.test(k))).toEqual([])
  })

  it('does not carry the radar axes under another name', () => {
    const text = JSON.stringify(payload)
    expect(text).not.toContain('Kept moving')
    expect(keysOf(payload)).not.toContain('axis')
  })
})
