/**
 * The manifest has to itemise everything the handoff carries.
 *
 * `handoff-send` serialises `GraphSnapshot.nodes()` — the whole graph, no
 * filter — while the Transfer page reads the groups back as a total and calls it
 * "what is now on the other device". Measured on the seeded graph: 92 records
 * sent, 76 itemised. The sixteen with no line were the five referees the vault
 * holds and the eleven organisations behind twelve applications; feeding a CV in
 * took the payload to 94 with the manifest still saying 76, because background
 * facts had no group either.
 *
 * An undercount here is not a cosmetic wrong number. It is the sentence a person
 * reads before deciding the move worked, on the one screen where the answer to
 * "did all of it arrive" is a number they cannot check any other way.
 *
 * So the census below is the test: boot the real graph, count what would go on
 * the wire, and require every kind of record in it to be claimed by a group.
 */
import { describe, expect, it } from 'vitest'
import { NODE_TYPES, type Instant, type NodeType } from '@jojo/service/core/model'
import { bootInMemory } from '@jojo/service/repo/boot'
import { createToolRuntime } from '@jojo/service/tools/runtime'
import { GROUP_OF, summarise, totalOf, type TransferGroup } from './groups'

/** Fixed, like every other test that boots the seed: D26, and buckets that drift. */
const NOW: Instant = new Date('2026-10-12T12:00:00').toISOString()

/**
 * Everything a handoff would put on the wire, by kind.
 *
 * The seed has no background facts — those arrive from a CV — so two are added
 * the way `profile.read-cv` adds them. Without that the type is absent from the
 * census and the assertion below passes by never seeing it, which is exactly how
 * it came to be missing from the manifest in the first place.
 */
function census(): Map<NodeType, number> {
  const { repo } = bootInMemory({ now: () => NOW })
  const runtime = createToolRuntime({ repo, now: () => NOW })
  runtime.run('profile.background.add', {
    background: [
      { kind: 'education', title: 'PhD, Computer Science' },
      { kind: 'skill', title: 'Rust' },
    ],
  } as never)

  const counted = new Map<NodeType, number>()
  for (const node of repo.getSnapshot().nodes())
    counted.set(node.type, (counted.get(node.type) ?? 0) + 1)
  return counted
}

/** The two that are knowingly uncounted, each with its reason in `groups.ts`. */
const DECLARED_UNTALLIED: NodeType[] = ['proposal', 'thread']

describe('GROUP_OF', () => {
  it('has an entry for every kind of record that can be stored', () => {
    // A backup carries every node, so a missing key is a record that travels
    // with nobody having decided whether the user should be told it did.
    expect(Object.keys(GROUP_OF).sort()).toEqual([...NODE_TYPES].sort())
  })

  it('gives the referees and the background facts a group of their own', () => {
    // The finding, stated as the two entries that were absent. `people` is not
    // folded into the vault and `background` is not folded into the profile:
    // the vault's hint names links and snippets, and the profile is one record
    // of what the user wants, not a list of what they have done.
    expect(GROUP_OF.person).toBe('people')
    expect(GROUP_OF.background).toBe('background')
  })

  it('leaves nothing uncounted that has not been argued for in writing', () => {
    // Null is allowed and is a decision. What is not allowed is a NEW null
    // arriving by default: this list is the diff that makes someone justify it.
    const untallied = Object.entries(GROUP_OF)
      .filter(([, group]) => group === null)
      .map(([type]) => type)
      .sort()
    expect(untallied).toEqual([...DECLARED_UNTALLIED].sort())
  })

  it('claims every kind of record the seeded graph would actually send', () => {
    // The measurement, re-run. `person` at 5 and `background` at 2 are in here,
    // and were in no group when this was written.
    const sent = [...census()].filter(([, count]) => count > 0).map(([type]) => type)
    const unclaimed = sent.filter(
      (type) => GROUP_OF[type] === null && !DECLARED_UNTALLIED.includes(type),
    )
    expect(unclaimed, 'records that travel with no line on the manifest').toEqual([])
    // And the census is reading something, so the line above cannot pass empty.
    expect(sent).toContain('person')
    expect(sent).toContain('background')
  })
})

describe('the sentence the page reads back', () => {
  const groups: TransferGroup[] = [
    { id: 'applications', label: 'Applications', unit: 'applications', hint: '', count: 12 },
    { id: 'people', label: 'People', unit: 'people', hint: '', count: 5 },
  ]

  it('totals and itemises the same groups', () => {
    expect(totalOf(groups)).toBe(17)
    expect(summarise(groups)).toBe('12 applications · 5 people')
  })

  it('says "nothing" rather than an empty sentence', () => {
    expect(summarise([])).toBe('nothing')
    expect(totalOf([])).toBe(0)
  })
})
