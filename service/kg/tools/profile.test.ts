/**
 * The target-roles panel, end to end, against a real repository.
 *
 * `profile.set` declared four fields — text, matchTerms, includeAcademia,
 * includeIndustry — and `roles` was not one of them, even though `roles` is a
 * real prop on the profile node, seeded from `DEFAULT_ROLES` and read back by
 * `useRoleVocabulary` to fill the role filter and the per-role figures in
 * Statistics. Both pages call `update({ roles: [...] })`. Nothing rejected the
 * key — `core/schema.ts` passes unknown keys through on purpose — and nothing
 * wrote it either, because `run` never named the field, so the call returned
 * `ok: true`. That is why it survived: a rejected call would have been noticed
 * the first time anyone typed a role.
 *
 * Measured before the fix, with the harness below: adding "Research Scientist"
 * left the stored list at exactly the five defaults.
 *
 * The tools' shared contract tests live in `tools.test.ts`; this file is only
 * about the field that went missing, including the undo half of D12 — a write
 * that persists but cannot be taken back is half a repair.
 */

import { describe, expect, it } from 'vitest'
import { MutableSnapshot } from '../core/snapshot'
import { DEFAULT_ROLES } from '../core/model'
import type { Profile } from '../core/model'
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

const rolesOf = (h: ReturnType<typeof harness>): string[] | undefined =>
  (h.repo.getSnapshot().ofType('profile')[0]?.props as { roles: string[] } | undefined)?.roles

const okOr = <T>(
  result: { ok: true; output: T } | { ok: false; errors: readonly { message: string }[] },
): T => {
  if (!result.ok) throw new Error(result.errors.map((e) => e.message).join('; '))
  return result.output
}

describe('profile.set and the role list', () => {
  it('persists a role the panel adds', () => {
    const h = harness()
    // Mints the profile node the way the page's first write does.
    okOr(h.runtime.run('profile.set', { matchTerms: ['distributed systems'] }))
    expect(rolesOf(h)).toEqual([...DEFAULT_ROLES])

    // Exactly what `addRole` in routes/Profile.tsx sends.
    okOr(h.runtime.run('profile.set', { roles: [...DEFAULT_ROLES, 'Research Scientist'] }))

    expect(rolesOf(h)).toEqual([...DEFAULT_ROLES, 'Research Scientist'])
  })

  it('persists a removal, and does not rewrite anything else on the record', () => {
    const h = harness()
    okOr(h.runtime.run('profile.set', { matchTerms: ['distributed systems'] }))

    // `removeRole` — the filtered list, and no other key.
    const kept = DEFAULT_ROLES.filter((r) => r !== 'Lecturer')
    okOr(h.runtime.run('profile.set', { roles: [...kept] }))

    expect(rolesOf(h)).toEqual([...kept])
    // The panel that shares the write must be untouched: `roles` and
    // `matchTerms` are two lists on one node and the chips commit one at a time.
    const props = h.repo.getSnapshot().ofType('profile')[0]!.props as {
      matchTerms: string[]
      includeAcademia: boolean
    }
    expect(props.matchTerms).toEqual(['distributed systems'])
    expect(props.includeAcademia).toBe(true)
  })

  it('undoes a role change back to the exact list it replaced (D12)', () => {
    const h = harness()
    okOr(h.runtime.run('profile.set', { matchTerms: ['distributed systems'] }))
    const before = rolesOf(h)

    okOr(h.runtime.run('profile.set', { roles: ['Only This One'] }))
    expect(rolesOf(h)).toEqual(['Only This One'])

    h.runtime.undo()
    expect(rolesOf(h)).toEqual(before)
  })

  /*
   * The generalising half, and the reason it is here rather than only in
   * `react/use-profile.test.ts`.
   *
   * `roles` went missing in TWO places on one write path — the hook's mapping
   * and this tool's patch — and each had to be fixed separately. The hook side
   * now has a test that fails when a field is added to the record and not
   * forwarded; this is the same guard for the tool side, which had none. Mutation
   * proves they are separate: deleting `roles` from `run`'s patch leaves the
   * hook's tests green, and deleting it from the mapping leaves this file green.
   *
   * `FULL` is annotated `Profile` rather than inferred, which is the whole
   * mechanism: add a sixth field to the record and this file stops COMPILING
   * until the sample names it, and then fails until `run` persists it.
   */
  it('persists every field of the record, not the ones somebody remembered', () => {
    const FULL: Profile = {
      text: {
        fullName: 'Dr A. Person',
        position: 'Postdoc',
        location: 'Zurich',
        email: 'a@example.org',
        website: 'https://example.org',
        scholar: 'https://scholar.example.org/a',
        github: 'https://github.com/a',
        linkedin: 'https://linkedin.com/in/a',
        targetRoles: 'Assistant Professor',
        regions: 'EU',
      },
      matchTerms: ['distributed systems'],
      roles: ['Assistant Professor', 'Research Scientist'],
      // Both default to true, so both are flipped: a patch that never ran would
      // otherwise be indistinguishable from one that wrote the seeded value.
      includeAcademia: false,
      includeIndustry: false,
    }

    const h = harness()
    okOr(h.runtime.run('profile.set', FULL))

    const props = h.repo.getSnapshot().ofType('profile')[0]!.props as unknown as Profile
    for (const key of Object.keys(FULL) as (keyof Profile)[]) {
      // Keyed loop rather than one deep compare, so the failure names the field
      // that was dropped instead of printing the whole record twice.
      expect({ [key]: props[key] }).toEqual({ [key]: FULL[key] })
    }
  })

  it('rejects a blank role rather than storing one nobody can name', () => {
    const h = harness()
    okOr(h.runtime.run('profile.set', { matchTerms: ['x'] }))
    const before = rolesOf(h)

    const result = h.runtime.run('profile.set', { roles: ['Postdoc', ''] })

    expect(result.ok).toBe(false)
    // A refusal that still wrote would be worse than the bug it replaced.
    expect(rolesOf(h)).toEqual(before)
  })
})
