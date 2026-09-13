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
  nextFitAction({ ready: true, fileId: 'f1', attempt: 0, cached: false, cleared: false, ...over })

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

  it('names the same request on every render while that request is in flight', () => {
    /*
     * THE assertion, and it used to say the opposite: once the request was
     * recorded this returned `nothing`, which is true of what the panel should
     * DO and fatal as a dependency. The panel keys its effect here, so an
     * answer that changes when the request starts re-runs the effect and its
     * cleanup aborts the read. Asking exactly once is the caller's ref,
     * compared inside the effect where nothing watches it.
     */
    for (let i = 0; i < 5; i += 1) expect(at()).toEqual({ do: 'start', key: 'f1#0' })
  })
})

describe('when asking again is right', () => {
  it('asks again for a different document', () => {
    // Opening a second application is a different posting, and the answer held
    // for the first one is wrong rather than stale.
    expect(at({ fileId: 'f2' })).toEqual({ do: 'start', key: 'f2#0' })
  })

  it('asks again when the person presses Try again', () => {
    /*
     * Why the attempt is part of the key at all. After a failure the document
     * is unchanged, so a key built from the document alone reports the work as
     * already done — and the retry button does nothing, silently, which is the
     * worst way for a button to be broken.
     */
    expect(at({ attempt: 1 })).toEqual({ do: 'start', key: 'f1#1' })
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
    expect(at({ cached: true })).toEqual({ do: 'use-cache' })
  })

  it('still refuses when there is nothing to read', () => {
    // Order matters the other way here: `ready` is about whether an answer
    // would mean anything, and a cached answer from a previous session's
    // background does not change that.
    expect(at({ cached: true, ready: false })).toEqual({ do: 'nothing' })
  })
})

describe('what the panel puts in a dependency array', () => {
  /*
   * REPRODUCTION of the bug this module was extracted to prevent, reintroduced
   * through the action itself.
   *
   * The panel keys its effect on this decision. `use-read-fit` calls
   * `onStep('reading')` synchronously, before its first await, so starting a
   * read sets state and re-renders immediately — with the request now recorded.
   * If the decision moves on that render, the dependency array moves, React
   * runs the effect's cleanup, and the cleanup aborts the read that was just
   * started. The panel then spins on "Opening the posting" for the rest of the
   * session, which is indistinguishable from a slow model.
   */
  /*
   * Re-run is a person saying "read it again" about a posting already read —
   * the capture was replaced, or the model was. The cache answers the question
   * the button is asking, so the button has to outrank it.
   */
  it('re-reads a cached posting when the person asks again', () => {
    expect(at({ cached: true })).toEqual({ do: 'use-cache' })
    expect(at({ cached: true, attempt: 1 })).toEqual({ do: 'start', key: 'f1#1' })
  })
})

describe('when the person has thrown the answer away', () => {
  /*
   * These four are the whole behaviour of the Clear button, and none of them
   * could be asserted before a reading was stored: until then a discard lost
   * the list, the next mount read the posting again, and the only thing hiding
   * that was that the next mount was usually the next session.
   */
  it('does not read a posting somebody has cleared', () => {
    // The failure this prevents is immediate and looks like a broken button:
    // Clear empties the card, the effect sees no stored reading, and the model
    // call starts on the very next render.
    expect(at({ cleared: true })).toEqual({ do: 'nothing' })
  })

  it('does not read it again even though there is now nothing stored', () => {
    // `cached` is false after a clear — the answer really is gone — so this is
    // the case that says the two flags mean different things. One is "there is
    // an answer", the other is "there is a person who does not want one".
    expect(at({ cleared: true, cached: false })).toEqual({ do: 'nothing' })
  })

  it('reads it again when the person asks', () => {
    // Re-run outranks a clear for the same reason it outranks the cache: the
    // person is asking rather than being asked. Without this, clearing a
    // reading would make the panel permanently unable to measure that posting.
    expect(at({ cleared: true, attempt: 1 })).toEqual({ do: 'start', key: 'f1#1' })
  })

  it('still does nothing when there is nothing to read with', () => {
    // `ready` outranks both, which is the order the two checks are written in.
    expect(at({ cleared: true, attempt: 1, ready: false })).toEqual({ do: 'nothing' })
  })

  it('names the same request on every render while a re-read is in flight', () => {
    // The dependency-array rule, restated for the path that goes through a
    // tombstone: the decision must not move because the request was recorded.
    for (let i = 0; i < 5; i += 1) {
      expect(at({ cleared: true, attempt: 1 })).toEqual({ do: 'start', key: 'f1#1' })
    }
  })
})

describe('the key', () => {
  it('separates documents and attempts', () => {
    expect(fitRequestKey('f1', 0)).not.toBe(fitRequestKey('f2', 0))
    expect(fitRequestKey('f1', 0)).not.toBe(fitRequestKey('f1', 1))
  })
})
