/**
 * What the app's boot bundle may reach in `kg/agent/` (review 3, performance-4).
 *
 * The agent loop is imported lazily (`react/agent-runs.ts`) so its code stays
 * off the first load. `react/app-note.ts` is in the boot bundle — the
 * transcript reads stored notes back to their catalog keys — and it used to
 * import four note constants from their producers (`budget`, `history`,
 * `round`, `exit`). Those imports pulled the loop's internals into the boot
 * preload as a 32 KB shared chunk. The notes now live in a leaf,
 * `agent/notes.ts`, with no value imports, and both of these must stay true or
 * the chunk comes back. Measured with a web build: before, index.html preloaded
 * `exit-*.js`; after, only the 2 KB `notes-*.js`.
 *
 * Read as source, here, because `kg/` has no `fs`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = (rel: string) => readFileSync(path.join(ROOT, rel), 'utf8')

/** Every module a file imports values from (`import type` is erased, so left out). */
const valueImports = (text: string) =>
  [...text.matchAll(/^import\s+(?!type\b)[^'"]*?from\s+'([^']+)'/gm)].map((m) => m[1])

describe('the boot bundle keeps the agent loop lazy (review 3)', () => {
  it('reads the app notes from the leaf, never from their producers', () => {
    const agent = valueImports(source('kg/react/app-note.ts')).filter((m) => m?.startsWith('../agent/'))
    expect(agent).toEqual(['../agent/notes'])
  })

  it('keeps the notes leaf free of value imports', () => {
    expect(valueImports(source('kg/agent/notes.ts'))).toEqual([])
  })
})
