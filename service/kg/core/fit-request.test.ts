/**
 * The decision the fit panel takes on every render.
 *
 * These exist because the panel cannot be tested — D20 means no component is
 * ever mounted here — and the rule they check is the one that was wrong: the
 * first version started a read, the read reported a step, the step re-ran the
 * effect, and the effect's cleanup aborted the read it had just started.
 *
 * So the assertions below are all about NOT asking twice, and about the two
 * cases where asking again is right.
 */

import { describe, expect, it } from 'vitest'
import { fitRequestKey, nextFitAction } from './fit-request'

const at = (over: Partial<Parameters<typeof nextFitAction>[0]> = {}) =>
  nextFitAction({ ready: true, fileId: 'f1', attempt: 0, cached: false, started: null, ...over })

describe('when there is nothing to do', () => {
  it('does nothing without a posting behind the record', () => {
    // Somebody typed this application in. Not a failure — there is simply no
    // text to weigh them against.
    expect(at({ fileId: undefined })).toEqual({ do: 'nothing' })
  })

  it('does nothing until there is a model and a background', () => {
    // `ready` carries both. Spending a round trip to be told "not measured" is
    // the one case where waiting to be asked is right.
    expect(at({ ready: false })).toEqual({ do: 'nothing' })
  })
})

describe('asking once', () => {
  it('starts on the first render that can', () => {
    expect(at()).toEqual({ do: 'start', key: 'f1#0' })
  })

  it('does not start again once it has', () => {
    /*
     * THE assertion. Every render after the request begins runs this again, and
     * a second start is not a wasted call — it is a second AbortController, so
     * the effect's cleanup cancels the request still in flight and the panel
     * never loads.
     */
    expect(at({ started: 'f1#0' })).toEqual({ do: 'nothing' })
  })

  it('keeps saying nothing however many times it is asked', () => {
    const started = 'f1#0'
    for (let i = 0; i < 5; i += 1) expect(at({ started })).toEqual({ do: 'nothing' })
  })
})

describe('when asking again is right', () => {
  it('asks again for a different document', () => {
    // Opening a second application is a different posting, and the answer held
    // for the first one is wrong rather than stale.
    expect(at({ fileId: 'f2', started: 'f1#0' })).toEqual({ do: 'start', key: 'f2#0' })
  })

  it('asks again when the person presses Try again', () => {
    /*
     * Why the attempt is part of the key at all. After a failure the document
     * is unchanged, so a key built from the document alone reports the work as
     * already done — and the retry button does nothing, silently, which is the
     * worst way for a button to be broken.
     */
    expect(at({ attempt: 1, started: 'f1#0' })).toEqual({ do: 'start', key: 'f1#1' })
  })
})

describe('when the answer is already known', () => {
  it('uses the cache rather than asking', () => {
    expect(at({ cached: true })).toEqual({ do: 'use-cache' })
  })

  it('uses the cache even though this record has never asked', () => {
    /*
     * The cache is keyed on the DOCUMENT, not the application, and this is the
     * case that makes that pay: two applications to the same posting, or one
     * opened after the create form prewarmed it. The second must show the
     * answer, not buy it twice.
     */
    expect(at({ cached: true, started: null })).toEqual({ do: 'use-cache' })
  })

  it('still refuses when there is nothing to read', () => {
    // Order matters the other way here: `ready` is about whether an answer
    // would mean anything, and a cached answer from a previous session's
    // background does not change that.
    expect(at({ cached: true, ready: false })).toEqual({ do: 'nothing' })
  })
})

describe('the key', () => {
  it('separates documents and attempts', () => {
    expect(fitRequestKey('f1', 0)).not.toBe(fitRequestKey('f2', 0))
    expect(fitRequestKey('f1', 0)).not.toBe(fitRequestKey('f1', 1))
  })
})
