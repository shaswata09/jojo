/**
 * Undo of a stage move puts back the dates the move stamped.
 *
 * The board's drag and the detail's stage pill used to undo by replaying a
 * patch built from the fields the page could see (stage, lastAction, daysAgo).
 * `application.update` also stamps `submittedOn` and `stageDates` on a stage
 * change, so Draft → Submitted → Undo left a draft that Statistics counted as
 * sent. Both now take the journal's `restore` (`useUndoable`); this asserts the
 * journal half of that against a real repository, with the exact input
 * `setStage` sends.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '@jojo/service/core/snapshot'
import { createRepository } from '@jojo/service/repo/repository'
import { createToolRuntime } from '@jojo/service/tools/runtime'
import { undoableWith } from '@jojo/service/react/undo'
import { applicationUpdateInput } from '@jojo/service/react/use-applications'

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

describe('undoing a stage move', () => {
  it('clears the submittedOn and stage dates the move stamped', () => {
    const h = harness()
    const created = h.runtime.run('application.create', {
      org: 'Rice University',
      role: 'Assistant professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
    })
    if (!created.ok) throw new Error('create failed')
    const id = created.output as string
    const props = () => h.repo.getSnapshot().node(id as never, 'application')?.props

    const before = { ...props() }

    const { restore } = undoableWith(h.repo, () =>
      h.runtime.run(
        'application.update',
        applicationUpdateInput(
          id,
          { stage: 'submitted', lastAction: 'Moved to Submitted' },
          '2026-10-12',
        ),
      ),
    )
    // The move did stamp them — otherwise the assertion below proves nothing.
    expect(props()?.submittedOn).toBeDefined()

    expect(restore).not.toBeNull()
    restore?.()

    expect(props()?.stage).toBe('draft')
    expect(props()?.submittedOn).toBeUndefined()
    expect(props()?.stageDates).toEqual(before.stageDates)
    expect(props()).toEqual(before)
  })
})
