/**
 * A send counts as a handover only when the phone's person took the records.
 *
 * The computer used to stamp `handoverAt` the moment the last chunk was
 * accepted — before the phone had asked its person anything. A transfer they
 * declined still left this page saying the phone held the same records. Now
 * the computer asks the phone what they decided (`awaitOutcome`) and stamps
 * only on `applied`; these pin the asking, and what the panel says for each
 * answer.
 */

import { describe, expect, it } from 'vitest'
import type { HandoffOutcome } from '@jojo/service/core/handoff'
import { awaitOutcome } from '@/lib/handoff-send'
import type { HandoffFailure } from '@/lib/handoff-client'
import { doneSentence } from '@/components/transfer-ui/done-sentence'
import sendSource from './handoff-send.ts?raw'

type Answer = { ok: true; value: HandoffOutcome } | { ok: false; error: HandoffFailure }

/** A phone that answers from a script, and a clock that moves only when slept. */
function rig(answers: Answer[]) {
  let clock = 0
  let asked = 0
  return {
    asked: () => asked,
    run: (limitMs = 60_000) =>
      awaitOutcome({
        ask: () => Promise.resolve(answers[Math.min(asked++, answers.length - 1)]!),
        sleep: (ms) => {
          clock += ms
          return Promise.resolve()
        },
        now: () => clock,
        cancelled: () => false,
        intervalMs: 2_000,
        limitMs,
      }),
  }
}

const pending: Answer = { ok: true, value: 'pending' }

describe('awaitOutcome', () => {
  it('keeps asking while the person is deciding, and returns what they chose', async () => {
    const r = rig([pending, pending, { ok: true, value: 'applied' }])
    expect(await r.run()).toBe('applied')
    expect(r.asked()).toBe(3)
  })

  it('returns a decline as a decline', async () => {
    expect(await rig([pending, { ok: true, value: 'declined' }]).run()).toBe('declined')
  })

  it('treats a phone that cannot say (an older build refuses the path) as unknown at once', async () => {
    const r = rig([{ ok: false, error: 'handoff/refused' }])
    expect(await r.run()).toBe('unknown')
    expect(r.asked()).toBe(1)
  })

  it('gives up on a phone that has gone quiet, without claiming anything', async () => {
    expect(await rig([{ ok: false, error: 'handoff/unreachable' }]).run()).toBe('unknown')
  })

  it('stops waiting after the limit, as unknown', async () => {
    expect(await rig([pending]).run(10_000)).toBe('unknown')
  })

  it('stamps the handover only after the phone says the records were applied', () => {
    const run = sendSource.slice(sendSource.indexOf('const answer = await awaitOutcome('))
    const guard = run.indexOf("if (answer !== 'applied') return")
    const stamp = run.indexOf('repo.setMeta(handedOver(')
    expect(guard).toBeGreaterThan(-1)
    expect(stamp).toBeGreaterThan(guard)
    // And nowhere else in the file.
    expect(sendSource.match(/repo\.setMeta\(handedOver\(/g)).toHaveLength(1)
  })
})

describe('what the panel says once everything is sent', () => {
  const at = { target: '192.168.1.23:50123' }

  it('says the phone holds the records only once it says it took them', () => {
    expect(doneSentence({ ...at, outcome: 'applied' })).toContain('now holds these records')
    for (const outcome of ['waiting', 'declined', 'failed', 'unknown'] as const) {
      expect(doneSentence({ ...at, outcome })).not.toContain('now holds')
    }
  })

  it('tells the person to confirm on the phone while it is still deciding', () => {
    expect(doneSentence({ ...at, outcome: 'waiting' })).toContain('confirm there to finish')
  })

  it('says nothing was replaced when the phone declined', () => {
    expect(doneSentence({ ...at, outcome: 'declined' })).toContain('nothing was replaced')
  })
})
