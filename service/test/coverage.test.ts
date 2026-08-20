/**
 * Every registered tool, exercised at least once, with the same round trip
 * `tools.test.ts` applies: run it, check the graph changed, undo it, check the
 * graph is byte-identical to what it was before.
 *
 * WHY THIS FILE EXISTS.
 *
 * The store under this app was replaced wholesale — a hand-written reducer out,
 * the web app's graph layer in — and the swap was verified by walking a handful
 * of journeys on a phone. That is a sample, and a sample is the wrong instrument
 * for a question of the form "does every write still work": the families most
 * likely to be broken by a swap are the ones nobody thought to tap through, and
 * those are exactly the ones a walkthrough misses.
 *
 * Counting told the real story. Barely half the registry was exercised anywhere
 * in the suite, and the tools that were not were not a random scattering — they
 * were most of the Vault, all of the scout and both of the profile setters.
 * Every one of those is reachable from a screen this app ships.
 *
 * That sentence used to carry the split as literals, "of 60 registered tools, 32
 * were exercised", eleven lines above another that said 62. The registry has
 * held 62 since before the extraction — measured at `b39fa9e` and at HEAD — so
 * one of the two was simply wrong, and a header that disagrees with itself is
 * settled by whichever line the next reader happens to read first. The split is
 * a fact about a suite that has since changed and is not recoverable from here;
 * `Object.keys(TOOLS).length` is the count, and the last test in this file reads
 * the registry rather than any number written down.
 *
 * So the point of this file is not the assertions, which are ordinary. It is the
 * last test in it, which fails if a tool is ever added to the registry without
 * being exercised anywhere. That is the part that stops the gap coming back.
 *
 * WHY IT IS IN `service/test/` AND NOT BESIDE THE TOOLS.
 *
 * It was written in the mobile app, at `src/kg/tools/coverage.test.ts`, and it
 * is the only thing either app had that answers this question — web named 35 of
 * the 62 registered tools across its whole suite and never named the other 27,
 * most of the Vault and all of the scout among them. So it came across with the
 * deletion rather than going with it.
 *
 * It cannot sit under `kg/` on arrival. It reads the suite off disk, and
 * `check-platform.mjs` bans `node:fs` throughout the scanned trees — correctly,
 * because a module in `kg/` that reaches for a filesystem is a module that will
 * not bundle on a phone. `service/test/` is in vitest's `include` and in neither
 * guard's root, which is the whole reason the directory exists.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../kg/core/snapshot'
import type { StoredEdge, StoredNode } from '../kg/core/model'
import { createRepository } from '../kg/repo/repository'
import type { Repository } from '../kg/repo/repository'
import { TOOLS } from '../kg/tools/index'
import { createToolRuntime } from '../kg/tools/runtime'

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

  return { repo, runtime: createToolRuntime({ repo, now }) }
}

function graphOf(repo: Repository) {
  const m = repo.getSnapshot()
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : 1)
  return {
    nodes: [...(m.nodes() as StoredNode[])].sort(byId),
    edges: [...(m.edges() as StoredEdge[])].sort(byId),
  }
}

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}

/** Which tools this file, and the rest of the suite, actually run. */
const exercised = new Set<string>()

type H = ReturnType<typeof harness>

/**
 * Run, assert, undo, assert the graph came back byte-identical.
 *
 * The undo half is not ceremony. An inverse-command undo passes the first
 * assertion and fails this one — recreating a deleted record mints a new id and
 * leaves every edge that pointed at the old one dangling, which reads as a
 * successful undo and is not one.
 */
function roundTrip<T>(h: H, tool: string, input: unknown, check: (output: T) => void) {
  exercised.add(tool)
  const before = graphOf(h.repo)
  const output = okOr(h.runtime.run(tool as never, input as never)) as T
  check(output)
  expect(graphOf(h.repo)).not.toEqual(before)
  h.runtime.undo()
  expect(graphOf(h.repo)).toEqual(before)
}

/** An application, an org and a deadline — the fixture most tools hang off. */
function anApplication(h: H) {
  return okOr(
    h.runtime.run('application.create', {
      org: 'Rice',
      role: 'Assistant professor',
      roleTag: 'Assistant Professor',
      stage: 'draft',
    }),
  )
}

const aLink = (h: H) =>
  okOr(
    h.runtime.run('vault.link.save', {
      title: 'Rice posting',
      url: 'https://jobs.rice.edu/1',
      category: 'Posting',
    }),
  )

/*
 * `[0]` is read into a local and checked rather than `!`-asserted, because this
 * package compiles under `noUncheckedIndexedAccess` and the mobile app that
 * wrote this file did not. The check is not ceremony either: `vault.file.add`
 * is the one bulk tool here, and an empty array back from it would otherwise
 * surface as `undefined` handed to a tool expecting an id, four assertions later.
 *
 * The draft carries `uri` so the field crosses the tool boundary at least once
 * in this suite. It is the only file-location prop either app writes, and it
 * spent the whole fork undeclared.
 */
const aFile = (h: H) => {
  const ids = okOr(
    h.runtime.run('vault.file.add', {
      files: [
        {
          name: 'CV.pdf',
          kind: 'pdf',
          bucket: 'Applications',
          size: '212 KB',
          uri: 'file:///data/user/0/dev.jojo/files/CV.pdf',
        },
      ],
    }),
  )
  const id = ids[0]
  if (id === undefined) throw new Error('vault.file.add returned no id.')
  return id
}

const aSnippet = (h: H) =>
  okOr(
    h.runtime.run('vault.snippet.create', {
      title: 'Why this department',
      tag: 'Cover letter',
      body: 'Because…',
    }),
  )

const aPipeline = (h: H) =>
  okOr(
    h.runtime.run('scout.pipeline.create', {
      name: 'Academic CS',
      source: 'HigherEdJobs',
      schedule: 'Daily',
      filter: 'assistant professor',
    }),
  )

const aMatch = (h: H) =>
  okOr(h.runtime.run('scout.match.save', { role: 'Lecturer', detail: 'Rice', fit: 70 }))

const aPosting = (h: H) =>
  okOr(
    h.runtime.run('scout.posting.save', { title: 'ML engineer', url: 'https://stripe.com/jobs/1' }),
  )

/* ------------------------------- the vault -------------------------------- */

describe('vault links', () => {
  it('updates, recategorises, duplicates and deletes, each undoably', () => {
    const h = harness()
    const id = aLink(h)

    roundTrip(h, 'vault.link.update', { id, title: 'Rice — Statistics' }, () => {
      expect(h.repo.getSnapshot().node(id, 'link')?.props.title).toBe('Rice — Statistics')
    })
    roundTrip(h, 'vault.link.recategorise', { id, category: 'Institution' }, () => {
      expect(h.repo.getSnapshot().node(id, 'link')?.props.category).toBe('Institution')
    })
    roundTrip(h, 'vault.link.duplicate', { id }, () => {
      expect(h.repo.getSnapshot().ofType('link')).toHaveLength(2)
    })
    roundTrip(h, 'vault.link.delete', { id }, () => {
      expect(h.repo.getSnapshot().node(id)).toBeUndefined()
    })
  })
})

describe('vault files', () => {
  it('updates, moves, notes and deletes, each undoably', () => {
    const h = harness()
    const id = aFile(h)

    roundTrip(h, 'vault.file.update', { id, name: 'CV-2026.pdf' }, () => {
      expect(h.repo.getSnapshot().node(id, 'file')?.props.name).toBe('CV-2026.pdf')
    })
    roundTrip(h, 'vault.file.move', { id, bucket: 'To read' }, () => {
      expect(h.repo.getSnapshot().node(id, 'file')?.props.bucket).toBe('To read')
    })
    roundTrip(h, 'vault.file.note.set', { id, note: 'v4 tightens the funding section' }, () => {
      expect(h.repo.getSnapshot().node(id, 'file')?.props.note).toBe(
        'v4 tightens the funding section',
      )
    })
    roundTrip(h, 'vault.file.delete', { id }, () => {
      expect(h.repo.getSnapshot().node(id)).toBeUndefined()
    })
  })
})

describe('vault snippets', () => {
  it('creates, updates, retags, duplicates and deletes, each undoably', () => {
    const h = harness()

    const before = graphOf(h.repo)
    exercised.add('vault.snippet.create')
    const id = aSnippet(h)
    expect(h.repo.getSnapshot().node(id, 'snippet')?.props.title).toBe('Why this department')
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)

    const live = aSnippet(h)
    roundTrip(h, 'vault.snippet.update', { id: live, body: 'Rewritten.' }, () => {
      expect(h.repo.getSnapshot().node(live, 'snippet')?.props.body).toBe('Rewritten.')
    })
    roundTrip(h, 'vault.snippet.retag', { id: live, tag: 'Email' }, () => {
      expect(h.repo.getSnapshot().node(live, 'snippet')?.props.tag).toBe('Email')
    })
    roundTrip(h, 'vault.snippet.duplicate', { id: live }, () => {
      expect(h.repo.getSnapshot().ofType('snippet')).toHaveLength(2)
    })
    roundTrip(h, 'vault.snippet.delete', { id: live }, () => {
      expect(h.repo.getSnapshot().node(live)).toBeUndefined()
    })
  })
})

/* ------------------------------- the scout -------------------------------- */

describe('scout pipelines', () => {
  it('creates, updates, toggles and deletes, each undoably', () => {
    const h = harness()

    const before = graphOf(h.repo)
    exercised.add('scout.pipeline.create')
    const id = aPipeline(h)
    expect(h.repo.getSnapshot().node(id, 'pipeline')?.props.name).toBe('Academic CS')
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)

    const live = aPipeline(h)
    roundTrip(h, 'scout.pipeline.update', { id: live, schedule: 'Weekly' }, () => {
      expect(h.repo.getSnapshot().node(live, 'pipeline')?.props.schedule).toBe('Weekly')
    })
    roundTrip(h, 'scout.pipeline.enable.set', { id: live, enabled: false }, () => {
      expect(h.repo.getSnapshot().node(live, 'pipeline')?.props.enabled).toBe(false)
    })
    roundTrip(h, 'scout.pipeline.delete', { id: live }, () => {
      expect(h.repo.getSnapshot().node(live)).toBeUndefined()
    })
  })
})

describe('scout matches and postings', () => {
  it('saves, updates and dismisses a match, each undoably', () => {
    const h = harness()

    const before = graphOf(h.repo)
    exercised.add('scout.match.save')
    const id = aMatch(h)
    expect(h.repo.getSnapshot().node(id, 'match')?.props.fit).toBe(70)
    h.runtime.undo()
    expect(graphOf(h.repo)).toEqual(before)

    const live = aMatch(h)
    roundTrip(h, 'scout.match.update', { id: live, fit: 88 }, () => {
      expect(h.repo.getSnapshot().node(live, 'match')?.props.fit).toBe(88)
    })
    roundTrip(h, 'scout.match.dismiss', { id: live }, () => {
      expect(h.repo.getSnapshot().node(live)).toBeUndefined()
    })
  })

  it('updates and deletes a posting, each undoably', () => {
    const h = harness()
    const id = aPosting(h)

    roundTrip(h, 'scout.posting.update', { id, title: 'ML engineer, inference' }, () => {
      expect(h.repo.getSnapshot().node(id, 'posting')?.props.title).toBe('ML engineer, inference')
    })
    roundTrip(h, 'scout.posting.delete', { id }, () => {
      expect(h.repo.getSnapshot().node(id)).toBeUndefined()
    })
  })
})

/* ------------------------ profile, offers, the rest ----------------------- */

describe('the profile', () => {
  /**
   * `profile.set` is the tool the Save bar on the profile page runs, and until
   * this test it was the one tool in the registry that nothing anywhere ran.
   *
   * It passed the guard at the bottom of this file because the literal
   * `tool: 'profile.set'` appears in a hand-built journal entry in
   * `kg/react/undo.test.ts` — a LABEL on a fixture, not a call. Both halves of
   * the tool could be deleted and all 474 tests stayed green: dropping the
   * `text` spread makes the page save and silently discard everything typed,
   * and dropping `matchTerms` makes the scout never store what it matches on.
   *
   * So every field it writes is asserted here by name. Asserting the node
   * merely EXISTS would not have caught either mutation — `profileNode` mints
   * the record before the patch runs, so the graph changes either way.
   */
  it('saves the whole page in one write, undoably', () => {
    const h = harness()

    roundTrip(
      h,
      'profile.set',
      {
        text: {
          fullName: 'A. Mitra',
          position: 'PhD candidate',
          location: 'Houston, TX',
          email: 'a@example.edu',
          website: 'https://example.edu/~a',
          scholar: 'https://scholar.example/a',
          github: 'https://github.com/a',
          linkedin: 'https://linkedin.com/in/a',
          targetRoles: 'Assistant professor',
          regions: 'US, EU',
        },
        matchTerms: ['distributed training', 'graph inference'],
        includeAcademia: false,
        includeIndustry: true,
      },
      () => {
        const profile = h.repo.getSnapshot().ofType('profile')[0]
        expect(profile?.props.text.fullName).toBe('A. Mitra')
        expect(profile?.props.text.regions).toBe('US, EU')
        expect(profile?.props.matchTerms).toEqual(['distributed training', 'graph inference'])
        expect(profile?.props.includeAcademia).toBe(false)
        expect(profile?.props.includeIndustry).toBe(true)
      },
    )
  })

  it('adds and removes a match term, each undoably', () => {
    const h = harness()

    roundTrip(h, 'profile.matchTerm.add', { term: 'distributed training' }, () => {
      expect(h.repo.getSnapshot().ofType('profile')[0]?.props.matchTerms).toContain(
        'distributed training',
      )
    })

    okOr(h.runtime.run('profile.matchTerm.add', { term: 'graph inference' }))
    roundTrip(h, 'profile.matchTerm.remove', { term: 'graph inference' }, () => {
      expect(h.repo.getSnapshot().ofType('profile')[0]?.props.matchTerms).not.toContain(
        'graph inference',
      )
    })
  })

  it('sets a text field and a preference, each undoably', () => {
    const h = harness()

    roundTrip(h, 'profile.text.set', { field: 'fullName', value: 'A. Mitra' }, () => {
      expect(h.repo.getSnapshot().ofType('profile')[0]?.props.text?.fullName).toBe('A. Mitra')
    })
    roundTrip(h, 'profile.preference.set', { key: 'includeIndustry', value: false }, () => {
      expect(h.repo.getSnapshot().ofType('profile')[0]?.props.includeIndustry).toBe(false)
    })
  })
})

describe('offers', () => {
  it('decides and clears an offer, each undoably', () => {
    const h = harness()
    const id = anApplication(h)
    okOr(h.runtime.run('application.stage.set', { id, stage: 'offer' }))
    // `application.offer.decide` refuses when there is nothing to decide on,
    // which is the right guard and means the fixture has to carry an offer.
    okOr(
      h.runtime.run('application.update', {
        id,
        offer: { respondBy: '2026-11-15', comp: '$112k', note: 'Negotiating.' },
      }),
    )

    roundTrip(h, 'application.offer.decide', { id, outcome: 'accepted' }, () => {
      expect(h.repo.getSnapshot().node(id, 'application')?.props.outcome).toBe('accepted')
    })
    roundTrip(h, 'application.offer.clear', { id }, () => {
      expect(h.repo.getSnapshot().node(id, 'application')?.props.offer).toBeUndefined()
    })
  })
})

describe('timeline and keywords', () => {
  it('updates a dated item undoably', () => {
    const h = harness()
    const app = anApplication(h)
    const item = okOr(
      h.runtime.run('timeline.item.create', {
        title: 'Submit',
        kind: 'deadline',
        date: '2026-11-01',
        applicationId: app,
      }),
    )

    roundTrip(h, 'timeline.item.update', { id: item, title: 'Submit the application' }, () => {
      expect(h.repo.getSnapshot().node(item, 'timelineItem')?.props.title).toBe(
        'Submit the application',
      )
    })
  })

  it('detaches a keyword from a record undoably, leaving the keyword', () => {
    const h = harness()
    const app = anApplication(h)
    const keyword = okOr(h.runtime.run('keyword.create', { name: 'Referral' }))
    okOr(h.runtime.run('keyword.attach', { record: app, keyword }))

    roundTrip(h, 'keyword.detach', { record: app, keyword }, () => {
      expect(h.repo.getSnapshot().node(keyword)).toBeDefined()
      expect(h.repo.getSnapshot().one(app, 'TAGS', 'keyword')).toBeUndefined()
    })
  })
})

/* -------------------------------------------------------------------------- */

/**
 * The test this file is really for.
 *
 * Reads the registry rather than a list somebody maintains, so a tool added
 * tomorrow and wired to a button lands here as a failure rather than as a write
 * nothing has ever run. The names it prints are the work, not the diagnosis.
 */
describe('the registry', () => {
  it('has no tool that no test anywhere exercises', async () => {
    const { readFileSync, readdirSync } = await import('node:fs')
    const { dirname, join } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    /*
     * Walked from this file rather than from `process.cwd()`, and recursively
     * rather than over a hardcoded list of five directory names.
     *
     * Both changes are the move's doing. `process.cwd()` was the mobile app root
     * and the path underneath it was `src/kg`; neither is true here, and a wrong
     * path in a `readdirSync` throws, which at least fails loudly. The
     * hardcoded list is the half that would have failed QUIETLY: a sixth layer
     * added under `kg/` would simply not be read, the suite string would be
     * short by that much, and this test would start reporting tools as
     * unexercised that are exercised — the failure mode of an
     * accuracy-guarantee is that people stop trusting it, and the reason this
     * file exists is that somebody has to.
     */
    const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
    let suite = ''
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
        const full = join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.test.ts')) suite += readFileSync(full, 'utf8')
      }
    }
    walk(ROOT)

    /*
     * The name has to appear where something RUNS it, not merely where it is
     * spelled.
     *
     * This used to be `suite.includes(`'${name}'`)` — the name in quotes,
     * anywhere in any test file. That is the accuracy guarantee this whole file
     * exists to provide, and it had exactly one false positive, which is one
     * more than it is allowed: `profile.set` satisfied it for the entire life of
     * the fork because `kg/react/undo.test.ts` builds a journal entry by hand
     * and a journal entry carries `tool: 'profile.set'` as a LABEL. The tool
     * that saves the whole profile page on both platforms was never called by
     * anything, and both halves of its `run` could be deleted with all 474 tests
     * green.
     *
     * A bare-quotes match cannot tell a call from a label, and labels are not
     * rare here: every hand-built `JournalEntry` fixture in the suite names the
     * tool that would have produced it. So the shapes that count are enumerated
     * instead, and they are the four this suite actually uses to run a tool:
     *
     *   `.run('name'`         the runtime, directly
     *   `roundTrip(h, 'name'` this file's helper
     *   `ctx.call('name'`     a tool calling a tool (`org.ensure`)
     *   `['name',`            a `[name, input]` case tuple, driven by a loop —
     *                         `tools.test.ts` runs fifteen tools this way
     *
     * `tool: 'name'` and `toContain('name')` are deliberately not among them.
     * The failure direction is safe: a tool exercised through a fifth shape
     * reports as missing, which is a visible failure and a one-line fix here,
     * whereas the shape this replaces failed silently and in the direction of
     * claiming coverage that did not exist.
     */
    const runs = (name: string) => {
      const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      return new RegExp(
        String.raw`(?:\.run|roundTrip|\.call)\(\s*(?:h\s*,\s*)?'${n}'|\[\s*'${n}'\s*,`,
      ).test(suite)
    }

    const missing = Object.keys(TOOLS).filter((name) => !exercised.has(name) && !runs(name))
    expect(missing).toEqual([])
  })
})
