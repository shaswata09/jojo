/**
 * The deadline the application form owns, renamed with its employer.
 *
 * The re-title rule used to live only in the web form's own copy of
 * `syncDeadline`, so `application.create{org:'Acme'}` then
 * `application.update{org:'Globex'}` — the assistant's path, MCP's, and the
 * phone's — left the calendar item reading 'Acme — Eng'. Driven through the
 * real runtime over the real repository, because what is asserted is what one
 * tool call leaves in the graph.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { createRepository } from '../repo/repository'
import type { NodeId } from '../core/model'
import { createToolRuntime } from './runtime'
import { applicationDeadlineOf } from './support'

type Options = Parameters<typeof createRepository>[0]

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

function created(h: ReturnType<typeof harness>) {
  return okOr(
    h.runtime.run('application.create', {
      org: 'Acme',
      role: 'Eng',
      roleTag: 'Industry',
      stage: 'draft',
      deadline: '2026-11-01',
    }),
  ) as NodeId
}

const titleOf = (h: ReturnType<typeof harness>, app: NodeId) =>
  applicationDeadlineOf(h.repo.getSnapshot(), app)?.props.title

describe('the deadline follows a rename', () => {
  it('re-titles the item when only the employer changed', () => {
    const h = harness()
    const app = created(h)
    expect(titleOf(h, app)).toBe('Acme — Eng')
    okOr(h.runtime.run('application.update', { id: app, org: 'Globex' }))
    expect(titleOf(h, app)).toBe('Globex — Eng')
  })

  it('re-titles it when the date moved in the same save', () => {
    const h = harness()
    const app = created(h)
    okOr(h.runtime.run('application.update', { id: app, role: 'Staff', deadline: '2026-11-08' }))
    const item = applicationDeadlineOf(h.repo.getSnapshot(), app)
    expect(item?.props.title).toBe('Acme — Staff')
    expect(item?.props.date).toBe('2026-11-08')
  })

  it('leaves a title the person wrote themselves alone', () => {
    const h = harness()
    const app = created(h)
    const item = applicationDeadlineOf(h.repo.getSnapshot(), app)
    if (!item) throw new Error('no deadline')
    okOr(h.runtime.run('timeline.item.update', { id: item.id, title: 'Portal closes' }))
    okOr(h.runtime.run('application.update', { id: app, org: 'Globex', deadline: '2026-11-08' }))
    expect(titleOf(h, app)).toBe('Portal closes')
  })

  it('is one journal entry, so one Undo puts the old name back on both', () => {
    const h = harness()
    const app = created(h)
    okOr(h.runtime.run('application.update', { id: app, org: 'Globex' }))
    okOr(h.runtime.undo())
    expect(titleOf(h, app)).toBe('Acme — Eng')
  })
})
