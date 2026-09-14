/**
 * The one write behind the tailoring card, against a real repository.
 *
 * What matters is not that a snippet appears. It is that the snippet says
 * where it came from, is filed under the job it was written for, can be taken
 * back byte for byte (D12), and that the two things which could quietly turn
 * a hand-made snippet into a "model wrote this" — a duplicate, and a create
 * through the ordinary tool — cannot.
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

const anApplication = (h: H) =>
  okOr(
    h.runtime.run('application.create', {
      org: 'Rice University',
      role: 'Assistant professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
    }),
  )

const graphOf = (h: H) => {
  const m = h.repo.getSnapshot()
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
  return { nodes: [...m.nodes()].sort(byId), edges: [...m.edges()].sort(byId) }
}

const TAILORED = {
  source: 'file:0192-cv' as string,
  kind: 'cv' as const,
  model: 'gemma_4_31b',
  title: 'CV — Rice University',
  tag: 'CV' as const,
  body: '## Summary\n**Distributed systems researcher** with a record in geo-replicated stores.',
}

describe('tailor.snippet.create', () => {
  it('files a snippet under the application with where it came from written on it', () => {
    const h = harness()
    const app = anApplication(h)

    const id = okOr(h.runtime.run('tailor.snippet.create', { applicationId: app, ...TAILORED }))

    const node = h.repo.getSnapshot().node(id, 'snippet')
    expect(node?.props.title).toBe('CV — Rice University')
    expect(node?.props.tag).toBe('CV')
    expect(node?.props.body).toBe(TAILORED.body)
    expect(node?.props.tailored).toEqual({
      source: 'file:0192-cv',
      kind: 'cv',
      model: 'gemma_4_31b',
      at: node?.props.tailored?.at,
    })
    // From `ctx.now`, not a real clock.
    expect(node?.props.tailored?.at.startsWith('2026-10-12')).toBe(true)
    expect(h.repo.getSnapshot().one(id, 'FILED_UNDER', 'application')?.id).toBe(app)
  })

  it('is undoable, byte for byte, edge included', () => {
    const h = harness()
    const app = anApplication(h)
    const before = graphOf(h)

    okOr(h.runtime.run('tailor.snippet.create', { applicationId: app, ...TAILORED }))
    expect(graphOf(h)).not.toEqual(before)
    h.runtime.undo()

    expect(graphOf(h)).toEqual(before)
  })

  it('refuses without the application', () => {
    const h = harness()
    const result = h.runtime.run('tailor.snippet.create', {
      applicationId: 'application:0192-nope' as NodeId,
      ...TAILORED,
    })
    expect(result.ok).toBe(false)
  })

  it('does not care whether the source document still exists', () => {
    // A breadcrumb, not a foreign key: the file may have been deleted while
    // the model was writing, and the text is still the person's.
    const h = harness()
    const app = anApplication(h)
    const result = h.runtime.run('tailor.snippet.create', {
      applicationId: app,
      ...TAILORED,
      source: 'file:0192-gone',
    })
    expect(result.ok).toBe(true)
  })

  it('refuses an empty body and an unknown kind', () => {
    const h = harness()
    const app = anApplication(h)
    expect(
      h.runtime.run('tailor.snippet.create', { applicationId: app, ...TAILORED, body: '' }).ok,
    ).toBe(false)
    expect(
      h.runtime.run('tailor.snippet.create', {
        applicationId: app,
        ...TAILORED,
        kind: 'thesis' as never,
      }).ok,
    ).toBe(false)
  })

  it('says what it saved and where', () => {
    const h = harness()
    const app = anApplication(h)
    const result = h.runtime.run('tailor.snippet.create', { applicationId: app, ...TAILORED })
    expect(result.ok && result.announcement.title).toBe('Tailored CV saved')
    expect(result.ok && result.announcement.description).toMatch(/Rice University/)
  })
})

describe('what must not claim a model wrote it', () => {
  it('a duplicate the person makes drops the provenance', () => {
    const h = harness()
    const app = anApplication(h)
    const id = okOr(h.runtime.run('tailor.snippet.create', { applicationId: app, ...TAILORED }))

    const copy = okOr(h.runtime.run('vault.snippet.duplicate', { id }))

    const node = h.repo.getSnapshot().node(copy, 'snippet')
    // And the marks go with the provenance: a body is only read as marked
    // when its record says a model wrote it, so the copy is plain text.
    expect(node?.props.body).toBe(
      'Summary\nDistributed systems researcher with a record in geo-replicated stores.',
    )
    expect(Object.hasOwn(node?.props ?? {}, 'tailored')).toBe(false)
    // The original keeps its own.
    expect(h.repo.getSnapshot().node(id, 'snippet')?.props.tailored).toBeDefined()
  })

  it('the ordinary snippet tool cannot stamp it', () => {
    // The card trusts `tailored` to mean "written by the model the person
    // asked". `vault.snippet.create` is on the twin pipeline's allowlist, so an
    // extra key handed to it must not become provenance.
    const h = harness()
    const app = anApplication(h)
    const id = okOr(
      h.runtime.run('vault.snippet.create', {
        title: 'Looks tailored',
        tag: 'CV',
        body: 'x',
        applicationIds: [app],
        tailored: { source: 'file:x', kind: 'cv', model: 'm', at: '2026-01-01T00:00:00.000Z' },
      } as never),
    )
    expect(Object.hasOwn(h.repo.getSnapshot().node(id, 'snippet')?.props ?? {}, 'tailored')).toBe(
      false,
    )
  })
})

describe('deleting one by hand', () => {
  it('goes through the ordinary snippet delete, with its undo', () => {
    const h = harness()
    const app = anApplication(h)
    const id = okOr(h.runtime.run('tailor.snippet.create', { applicationId: app, ...TAILORED }))
    const before = graphOf(h)

    const result = h.runtime.run('vault.snippet.delete', { id })
    expect(result.ok).toBe(true)
    expect(h.repo.getSnapshot().node(id, 'snippet')).toBeUndefined()

    h.runtime.undo()
    expect(graphOf(h)).toEqual(before)
  })
})


describe('naming the copy in the same write', () => {
  /*
   * Both apps put "(copy)" on the end. Doing that with a follow-up
   * `vault.snippet.update` made one button press two journal entries, so a
   * single ⌘Z took the rename back and left a copy carrying the original's
   * exact title, beside the original — the confusion Duplicate exists to avoid.
   */
  it('takes the title, and still drops the provenance and the marks', () => {
    const h = harness()
    const source = okOr(
      h.runtime.run('vault.snippet.create', {
        title: 'CV',
        tag: 'CV',
        body: '## Summary\n**Distributed systems** researcher.',
      }),
    )
    const before = h.repo.undoable.length
    const copy = okOr(h.runtime.run('vault.snippet.duplicate', { id: source, title: 'CV (copy)' }))
    const made = h.repo.getSnapshot().node(copy, 'snippet')
    expect(made?.props.title).toBe('CV (copy)')
    // One press, one thing to undo.
    expect(h.repo.undoable.length).toBe(before + 1)
  })

  it('keeps the source title when none is given', () => {
    const h = harness()
    const source = okOr(
      h.runtime.run('vault.snippet.create', { title: 'CV', tag: 'CV', body: 'plain text' }),
    )
    const copy = okOr(h.runtime.run('vault.snippet.duplicate', { id: source }))
    expect(h.repo.getSnapshot().node(copy, 'snippet')?.props.title).toBe('CV')
  })
})
