/**
 * The one line `use-tool.ts` argues for its own existence on, which nothing
 * asserted.
 *
 * The hook has no call sites and is kept deliberately: its header says the Undo
 * it wires "is not the obvious one, and the obvious one is a bug", and that
 * paragraph is the only place in the repo where the reason not to paste
 * `result.undo` into a toast is written down. `undo` on a `ToolResult` is the
 * single most copyable line in the tools API. But the hook was also the only
 * module in `kg/react` with neither a caller nor a test, so swapping `restore`
 * for `result.undo` — the exact paste being warned against — was green on the
 * whole suite. An essay guarding a line that nothing pins is a comment, not a
 * guard.
 *
 * Asserted through `runWithToast` rather than through the hook. D20: no
 * component tests, no jsdom — the binding layer is thin by construction, so the
 * decision takes its three collaborators as arguments and the hook is the
 * `useCallback` around it. The `undoable` handed over here is the real
 * `undoableWith` against a real repository, because the guard is the subject.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import type { StoredEdge, StoredNode } from '../core/model'
import { createRepository } from '../repo/repository'
import type { Repository } from '../repo/repository'
import { createToolRuntime } from '../tools/runtime'
import type { ToastOptions } from './toast'
import { undoableSaying } from './undo'
import { runWithToast } from './use-tool'

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
    },
    now,
  })

  const runtime = createToolRuntime({ repo, now })
  const said: ToastOptions[] = []

  return {
    repo,
    runtime,
    said,
    /** Exactly what `useTool` assembles, with the toast recorded rather than shown. */
    deps: {
      run: runtime.run,
      undoable: <T>(write: () => T) =>
        undoableSaying(repo, (options) => void said.push(options), write),
      toast: (options: ToastOptions) => void said.push(options),
    },
  }
}

function graphOf(repo: Repository) {
  const m = repo.getSnapshot()
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
  return {
    nodes: [...(m.nodes() as StoredNode[])].sort(byId),
    edges: [...(m.edges() as StoredEdge[])].sort(byId),
  }
}

const anApplication = {
  org: 'Rice',
  role: 'Assistant professor',
  roleTag: 'Assistant Professor',
  stage: 'draft',
} as const

/** The toast's Undo, or a failure that names what was on screen instead. */
function undoOf(said: readonly ToastOptions[]) {
  const last = said.at(-1)
  if (!last) throw new Error('nothing was announced')
  const action = last.action
  if (!action) throw new Error(`the toast "${last.title}" carried no Undo`)
  return action
}

describe('the toast a tool fires', () => {
  it('announces the tool own words and offers an Undo', () => {
    const h = harness()
    const result = runWithToast(h.deps, 'application.create', anApplication)

    expect(result.ok).toBe(true)
    expect(h.said).toHaveLength(1)
    expect(h.said[0]?.title).toContain('Rice')
    expect(undoOf(h.said).label).toBe('Undo')
  })

  it('lets a card reword the announcement without rewording the tool', () => {
    const h = harness()
    runWithToast(h.deps, 'application.create', anApplication, (a) => ({
      ...a,
      description: 'Hidden while the keyword filter is on',
    }))
    expect(h.said[0]?.description).toBe('Hidden while the keyword filter is on')
  })

  /**
   * A refusal is something the user can act on, so it is shown in the tool's own
   * words — and it carries no Undo, because nothing was committed to undo.
   */
  it('shows a refusal as itself and offers nothing to undo', () => {
    const h = harness()
    const before = graphOf(h.repo)

    const result = runWithToast(h.deps, 'application.stage.set', {
      id: 'application_missing',
      stage: 'offer',
    })

    expect(result.ok).toBe(false)
    expect(h.said[0]?.tone).toBe('danger')
    expect(h.said[0]?.action).toBeUndefined()
    expect(graphOf(h.repo)).toEqual(before)
  })
})

describe('the Undo it wires is undoableWith, not result.undo', () => {
  it('reverts everything one press committed', () => {
    const h = harness()
    const before = graphOf(h.repo)

    // A composite: the record, its employer and the deadline the form minted.
    runWithToast(h.deps, 'application.create', {
      ...anApplication,
      deadline: '2026-11-01',
    })
    expect(graphOf(h.repo)).not.toEqual(before)

    undoOf(h.said).onClick()
    expect(graphOf(h.repo)).toEqual(before)
  })

  /**
   * The first half of the essay, and the reason that paragraph was rewritten.
   *
   * It used to claim an unguarded `result.undo` pressed after ⌘Z "UNDOES the
   * undo". Probed on both a create and an update, it does not: an inverted
   * before-image is idempotent, so the graph is byte-identical either way and
   * the first two assertions below pass with or without the guard.
   *
   * What an unguarded revert actually costs is the REDO STACK. `repo.revert`
   * falls through to the audit ring and ends in `redo.clear()`, so ⇧⌘Z — which
   * the user has every right to expect after ⌘Z — silently refuses and the work
   * stays undone. Nothing on screen changes at the moment it is caused, which is
   * what makes it worth a test rather than a paragraph. `undoableWith` skips the
   * entry instead, because it is no longer on the undo stack, and never calls
   * `revert` at all.
   */
  it('leaves redo intact when ⌘Z has already undone the entry', () => {
    const h = harness()
    const before = graphOf(h.repo)

    runWithToast(h.deps, 'application.create', anApplication)
    const created = graphOf(h.repo)
    const undo = undoOf(h.said)

    // ⌘Z first — the keyboard path, which is not this toast.
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)

    undo.onClick()
    expect(graphOf(h.repo)).toEqual(before)

    // The assertion that separates the guarded Undo from `result.undo`.
    expect(h.repo.redoable).toHaveLength(1)
    expect(h.runtime.redo().ok).toBe(true)
    expect(graphOf(h.repo)).toEqual(created)
  })

  /** The same guard seen from the toast's own side: a double press is idempotent. */
  it('is idempotent when the button is pressed twice', () => {
    const h = harness()
    const before = graphOf(h.repo)

    runWithToast(h.deps, 'application.create', anApplication)
    const undo = undoOf(h.said)

    undo.onClick()
    undo.onClick()
    expect(graphOf(h.repo)).toEqual(before)
  })

  /**
   * The second half of the essay: "pressed after the user has written to the
   * same record again, it puts a whole before-image back over what they typed
   * (D12)."
   *
   * The write is left standing and the user is told, rather than the note being
   * silently discarded — saying nothing was the original bug's second half.
   */
  it('leaves a record the user has since written to, and says so', () => {
    const h = harness()

    const created = runWithToast(h.deps, 'application.create', anApplication)
    if (!created.ok) throw new Error('the fixture did not create')
    const undo = undoOf(h.said)

    h.runtime.run('application.note.set', { id: created.output, note: 'Called the chair' })
    const after = graphOf(h.repo)

    undo.onClick()

    expect(graphOf(h.repo)).toEqual(after)
    expect(h.repo.getSnapshot().node(created.output, 'application')?.props.note).toBe(
      'Called the chair',
    )
    expect(h.said.at(-1)?.title).toBe('Nothing was undone')
    expect(h.said.at(-1)?.tone).toBe('danger')
  })
})
