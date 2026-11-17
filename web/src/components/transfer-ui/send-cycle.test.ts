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
import { sameNetwork, stageCopy } from './stage-copy'

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

/*
 * Q129: receiving from the phone pairs the same way, so the same rule decides
 * when its code is spent — with the two stages a person sits in while what
 * arrived waits for them.
 */
describe('the same rule, receiving from the phone', () => {
  it('keeps the code while a pull is still going, including at the confirmation', () => {
    for (const stage of ['connecting', 'receiving', 'confirming', 'restoring'] as const) {
      expect(replacesOffer(stage, true), stage).toBe(false)
    }
  })

  it('replaces it once the pull that used it has stopped', () => {
    expect(replacesOffer('failed', true)).toBe(true)
    expect(replacesOffer('idle', true)).toBe(true)
    expect(replacesOffer('failed', false)).toBe(false)
  })

  it('shows the code to the phone while waiting and after a stop, never mid-pull', () => {
    expect(showsOffer('idle')).toBe(true)
    expect(showsOffer('failed')).toBe(true)
    for (const stage of ['connecting', 'receiving', 'confirming', 'restoring', 'done'] as const) {
      expect(showsOffer(stage), stage).toBe(false)
    }
  })
})

describe('what the stage card says (Q129)', () => {
  it('no longer says this computer cannot receive, at any stage', () => {
    for (const stage of [
      'idle',
      'connecting',
      'receiving',
      'confirming',
      'restoring',
      'done',
      'failed',
    ] as const) {
      const copy = stageCopy('receive', stage)
      expect(`${copy.title} ${copy.body}`, stage).not.toMatch(
        /cannot receive|not allowed to accept/i,
      )
    }
  })

  it('tells the person what to choose on the phone, in each direction', () => {
    expect(stageCopy('receive', 'idle').body).toContain('Send to a computer')
    expect(stageCopy('send', 'idle').body).toContain('Receive from a computer')
  })

  it('says plainly that both devices must be on the same network', () => {
    expect(sameNetwork()).toMatch(/same local network/)
    expect(stageCopy('receive', 'idle').body).toContain(sameNetwork())
    expect(stageCopy('send', 'idle').body).toContain(sameNetwork())
  })

  it('promises nothing here changes until the person agrees', () => {
    expect(stageCopy('receive', 'receiving').body).toMatch(
      /Nothing on this computer changes until you agree/,
    )
    expect(stageCopy('receive', 'failed').body).toMatch(/Nothing on this computer has changed/)
  })
})
