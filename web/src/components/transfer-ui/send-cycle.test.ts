/**
 * The Transfer page's code-on-screen rule.
 *
 * A failed send used to mint a new code for every failure. A typo in the
 * address is caught before the phone is ever asked, so the phone still held
 * the old offer and listened under its token; the corrected address then
 * reached it under the new token and was refused, and the person had to scan
 * again for a mistake that never touched the pairing.
 */
import { describe, expect, it } from 'vitest'
import type { SendStage } from '@/lib/handoff-send'
import { replacesOffer, showsOffer } from './send-cycle'

const STAGES: readonly SendStage[] = ['idle', 'connecting', 'packing', 'sending', 'done', 'failed']

describe('replacesOffer', () => {
  it('keeps the code after a failure before the phone answered, so retyping works', () => {
    // A mistyped address, or an address that did not answer.
    expect(replacesOffer('failed', false)).toBe(false)
  })

  it('replaces the code once the answer was used and the run is over', () => {
    expect(replacesOffer('done', true)).toBe(true)
    // Refused by the pairing, or stopped mid-convoy: the offer is spent.
    expect(replacesOffer('failed', true)).toBe(true)
    // Abandoned after pairing (a role switch cancels to idle).
    expect(replacesOffer('idle', true)).toBe(true)
  })

  it('never replaces the code a run is still using', () => {
    for (const stage of ['connecting', 'packing', 'sending'] as const) {
      expect(replacesOffer(stage, true)).toBe(false)
    }
  })

  it('never replaces a code no answer has touched', () => {
    for (const stage of STAGES) expect(replacesOffer(stage, false)).toBe(false)
  })
})

describe('showsOffer', () => {
  it('shows the code while waiting and after a run that stopped', () => {
    // After a failure the code on screen is either the live one or the new
    // one the panel asks the person to scan, so hiding it leaves nothing to scan.
    expect(showsOffer('idle')).toBe(true)
    expect(showsOffer('failed')).toBe(true)
  })

  it('hides it mid-run and on the finished card', () => {
    for (const stage of ['connecting', 'packing', 'sending', 'done'] as const) {
      expect(showsOffer(stage)).toBe(false)
    }
  })
})
