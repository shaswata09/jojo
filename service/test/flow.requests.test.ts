/**
 * Owner request Q201: agent workflows run on jojo's own runner, not LangGraph.
 *
 * The decision was to reject LangChain/LangGraph and build `flow.ts` — linear
 * and branching steps, retries, a step budget. `flow.test.ts` pins the runner's
 * behaviour; what it cannot pin is the other half of the decision, that the
 * library did not come back in through a package manifest. A dependency added
 * "just for one workflow" would pass every runner test.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

const MANIFESTS = ['package.json', 'service/package.json', 'web/package.json', 'mobile/package.json']

const dependenciesOf = (rel: string): string[] => {
  const json = JSON.parse(readFileSync(path.join(ROOT, rel), 'utf8')) as Record<string, unknown>
  return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap((key) =>
    Object.keys((json[key] as Record<string, string> | undefined) ?? {}),
  )
}

describe('what the agent workflows run on', () => {
  it('reads every workspace manifest, so the check below is not vacuous', () => {
    // The root manifest only declares the workspaces; the three below it carry the code.
    for (const rel of MANIFESTS.slice(1)) expect(dependenciesOf(rel).length, rel).toBeGreaterThan(0)
  })

  it('depends on no LangChain or LangGraph package in any workspace', () => {
    for (const rel of MANIFESTS) {
      const found = dependenciesOf(rel).filter((name) => /lang(chain|graph)/i.test(name))
      expect(found, rel).toEqual([])
    }
  })
})
