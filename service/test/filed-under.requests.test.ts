/**
 * Q089, the wiring half: the application page's selectors read through
 * `filedUnder`, so the membership rule tested in
 * `kg/core/filed-under.requests.test.ts` is the one the Filed panel and the
 * application's timeline actually apply. The hooks cannot be called outside
 * React (D20), so they are read as source — here, because `kg/` has no `fs`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/** Line comments stripped, so prose about the rule cannot stand in for it. */
const source = (rel: string) =>
  readFileSync(path.join(ROOT, rel), 'utf8').replace(/\/\/[^\n]*/g, ' ')

describe('the application page reads through filedUnder (Q089)', () => {
  it('selects the vault records filed under a job with filedUnder', () => {
    const vault = source('kg/react/use-vault.ts')
    for (const list of ['links', 'files', 'snippets', 'people']) {
      expect(vault).toContain(`${list}: filedUnder(${list}, appId)`)
    }
  })

  it('selects the timeline items filed under a job with filedUnder', () => {
    expect(source('kg/react/use-timeline.ts')).toContain('(appId: string) => filedUnder(all, appId)')
  })
})
