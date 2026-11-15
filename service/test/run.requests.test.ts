/**
 * Owner request Q216: the benchmark runner measures what production does.
 *
 * `bench/run.mts` talks to live endpoints and has no unit seam, so its three
 * instrumentation fixes are pinned on its source — each one a line that, put
 * back the old way, silently changes what every published score means:
 *
 *   - a malformed argument string must reach the loop as `null`, the value
 *     production's `safeParse` gives, not be laundered into `{}` (which sent it
 *     down the validation path, so the invalid-JSON bucket never filled);
 *   - no `max_tokens` cap unless one is asked for (1,400 was below a reasoning
 *     model's own pre-answer floor; production sends none);
 *   - each turn's `finishReason` and answer text are kept in the report.
 *
 * The scorer half — a do-nothing agent cannot pass a read-only turn — is pinned
 * behaviourally in `kg/agent/bench-score.test.ts`.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(path.join(ROOT, 'bench', 'run.mts'), 'utf8')

describe('the benchmark runner’s instrumentation', () => {
  it('parses malformed tool arguments to null, as production does, never to {}', () => {
    expect(source).toMatch(/try \{ parsed = JSON\.parse\(text\) \} catch \{ parsed = null \}/)
    expect(source).not.toMatch(/catch \{ parsed = \{\} \}/)
  })

  it('sends no max_tokens unless the run asks for one', () => {
    expect(source).toMatch(/const MAX_TOKENS = Number\(process\.env\['BENCH_MAX_TOKENS'\] \?\? 0\) \|\| 0/)
    // Every place a request is built spreads the cap in only when it is set.
    const sends = source.match(/max_tokens: /g) ?? []
    const guarded = source.match(/\.\.\.\(MAX_TOKENS > 0 \? \{ max_tokens: MAX_TOKENS \} : \{\}\)/g) ?? []
    expect(guarded.length).toBeGreaterThan(0)
    expect(guarded.length).toBe(sends.length)
  })

  it('keeps each turn’s finish reason and answer text in the report', () => {
    expect(source).toMatch(/finishReason: t\.finishReason,/)
    expect(source).toMatch(/answer: t\.answer === null \? null : t\.answer\.slice\(/)
  })
})
