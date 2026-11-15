/**
 * Q306 — "make sure it also checks and parses and confirms all filled ones if
 * vLLM is available and user clicks add to application."
 *
 * "Add to applications" on a saved posting is `onPromotePosting`. With a model
 * configured it hands the new draft to `fillDraft` — the same read approval
 * makes — which has the model read the page and report each field it filled or
 * CONFIRMED (`fillPatch`'s `confirmed`, tested in `fill-from-posting.test.ts`,
 * "reports what the page confirmed, ignoring case"). Without one it only keeps
 * the page. The gate and the hand-off live in a hook (D20), so they are read
 * out of the source.
 */
import { describe, expect, it } from 'vitest'
import source from './use-posting-actions.ts?raw'

const code = source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('Q306 Add to applications has the model check the draft when one is set up', () => {
  it('reads the posting into the new draft exactly when a model is configured', () => {
    expect(code).toMatch(/const reading = Boolean\(posting\) && isConfigured\(settings\)/)
    expect(code).toMatch(
      /if \(posting && reading\) void fillDraft\(application, posting\.url, posting\.title\)\s*else if \(posting && !pages\.pageFor\(posting\)\) pages\.keepAndReport\(posting\.url, posting\.title\)/,
    )
  })

  it('makes the draft first, so the read has a record to fill', () => {
    const promote = code.indexOf('undoable(() => promotePosting(postingId))')
    const read = code.indexOf('void fillDraft(application, posting.url, posting.title)')
    expect(promote).toBeGreaterThan(-1)
    expect(read).toBeGreaterThan(promote)
  })
})
