/**
 * Q127 — Pipeline 2 (the scout) scouts postings from the profile and the saved
 * search links, and for each one says what the person would need to tailor.
 * The dedupe and the queue-only rules are pinned in `pipelines.test.ts` and
 * `proposal.test.ts`; the tailoring suggestion lives only in the prompt, so it
 * is pinned here, along with the fact that no `auto` switch changes it.
 */

import { describe, expect, it } from 'vitest'
import { PIPELINE_PROMPTS, pipelinePrompt } from './pipelines'

describe('Q127 what the scout is asked to do', () => {
  it('asks for the tailoring each posting would need, from the profile and the saved searches', () => {
    const prompt = pipelinePrompt('scout', false)
    expect(prompt).toContain('what they would need to tailor')
    expect(prompt).toContain('using their profile and the searches they have saved')
  })

  it('is told the same thing whether or not the pipeline is marked auto', () => {
    expect(pipelinePrompt('scout', true)).toBe(PIPELINE_PROMPTS.scout)
  })
})
