/**
 * A key never leaves the device by any path this app controls.
 *
 * The promise made on the Settings card is "kept in this browser only… never put
 * in a backup and never sent anywhere but the provider", and saved connections
 * now carry keys — so the promise covers more than it did and is worth pinning
 * rather than restating.
 *
 * It is NOT a claim about encryption at rest, and pretending otherwise would be
 * the dishonest version of this file. There is no passphrase, and a cipher whose
 * key sits in the same store as the ciphertext protects nobody. What is true is
 * structural: a backup serialises the GRAPH, keys are not in the graph, so no
 * export or Transfer can carry one. These tests assert that structure.
 */

import { describe, expect, it } from 'vitest'
import { NODE_TYPES } from '@jojo/service/core/model'
import { SERVERS_KEY, STORAGE_KEY } from '@/lib/model-settings-context'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const SELF = '/src/lib/keys-stay-local.test.ts'

describe('where a key is allowed to live', () => {
  it('is not a node type, so a backup cannot serialise one', () => {
    /*
     * The load-bearing fact. `core/backup.ts` writes nodes, edges and documents;
     * if a credential were ever modelled as a node it would land in every export
     * and every Transfer, and the card's promise would quietly become false.
     */
    /*
     * Named exactly, not matched as a substring. The first version of this
     * checked `.includes('key')` and failed on `keyword`, which is a real node
     * type and has nothing to do with credentials — a guard that fires on an
     * innocent name is a guard somebody deletes.
     */
    const credentialish = ['apikey', 'key', 'credential', 'secret', 'token', 'password']
    for (const type of NODE_TYPES) {
      expect(credentialish, `node type "${type}"`).not.toContain(type.toLowerCase())
    }
    // And the one that would be easiest to add by habit.
    expect([...NODE_TYPES] as string[]).not.toContain('apiKey')
  })

  it('lives under the settings keys, which are outside the graph', () => {
    // Both are plain browser-storage keys, read and written by
    // `model-settings.tsx` alone — nothing in `kg/` knows they exist.
    expect(STORAGE_KEY).toMatch(/^jojo\//)
    expect(SERVERS_KEY).toMatch(/^jojo\//)
    expect(STORAGE_KEY).not.toBe(SERVERS_KEY)
  })

  it('is never written into a tool call, a node or an edge', () => {
    /*
     * The realistic way this breaks: somebody adds "remember my key" as a tool
     * so the agent can set it, and it becomes a node. Searched as source text
     * because that is the shape of the mistake.
     */
    const offenders: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF) continue
      // A key being put INTO graph-bound data, rather than read from settings.
      if (/props:\s*\{[^}]*apiKey/.test(source)) offenders.push(`${path} — apiKey in node props`)
      if (/ctx\.call\([^)]*apiKey/.test(source)) offenders.push(`${path} — apiKey passed to a tool`)
    }
    expect(
      offenders,
      `A key must not reach the graph: backups serialise it and Transfer sends it.\n${offenders.join('\n')}`,
    ).toEqual([])
  })

  it('is only ever sent as an Authorization header, never in a body', () => {
    const offenders: string[] = []
    for (const [path, source] of Object.entries(sources)) {
      if (path === SELF) continue
      // `api_key` in a JSON body is how some SDKs do it and is how a key ends up
      // in a request log somebody later pastes into an issue.
      if (/JSON\.stringify\([^)]*api_key/.test(source)) offenders.push(path)
    }
    expect(offenders).toEqual([])
  })
})
