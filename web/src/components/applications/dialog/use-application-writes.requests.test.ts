/**
 * Q185: creating an application sets off the fit assessment, so its fit and
 * the tailoring and preparation guidance are ready when the record is opened.
 *
 * Creating does not open the record, so the read is started from the create
 * path ("prewarm") and stored on the posting; the panel then assesses it with
 * `assess()` → `guidanceFrom()` on every render. That chain is held end to end
 * by `service/test/posting-to-guidance.test.ts`. What only exists in this hook
 * is that a create starts the read, so D20 leaves a narrow source read.
 */

import { describe, expect, it } from 'vitest'
import writes from './use-application-writes.ts?raw'

const create = /function create\(\): SaveOutcome \{[\s\S]*?\n {2}\}\n/.exec(writes)?.[0] ?? ''
const prewarm = /function prewarmFit\(\): void \{[\s\S]*?\n {2}\}\n/.exec(writes)?.[0] ?? ''

describe('Q185 — creating an application starts its fit assessment', () => {
  it('starts the read from the create path, once the record is written', () => {
    expect(create).not.toBe('')
    const written = create.indexOf('if (created === null) return')
    const warmed = create.indexOf('prewarmFit()')
    expect(written).toBeGreaterThan(0)
    expect(warmed).toBeGreaterThan(written)
  })

  it('reads the posting the record came from, or the one at its URL', () => {
    expect(prewarm).toMatch(/: postingSourceForUrl\(graph, form\.url\.trim\(\) \|\| undefined\)/)
    expect(prewarm).toMatch(/void readFit\(\{ fileId: source\.fileId, name: source\.name, settings \}\)/)
  })

  it('skips only what could not be measured: no posting, no model, no background', () => {
    expect(prewarm).toContain('if (!source) return')
    expect(prewarm).toContain("if (settings.model.trim() === '') return")
    expect(prewarm).toContain('if (projections.background(graph).length === 0) return')
  })
})
