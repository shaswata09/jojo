/**
 * Confirming a restore must not also run the panel's cancel path.
 *
 * `ui/ConfirmSheet.tsx`'s confirm button is `onPress={() => { onClose();
 * onConfirm() }}`, and `ReceivePanel` had its whole decline path in `onClose`.
 * Tapping **Replace** therefore dropped the session, zeroed the byte count and
 * wrote "Nothing was changed. Scan the code again to receive." on screen — and
 * then started replacing every record on the phone underneath it, because
 * `applyPending` still held the plan through its render closure.
 *
 * The sequences below are the button's, in the order it fires them. The one
 * marked "whatever order" is not defensive noise: the ordering is a fact about a
 * different file that this one cannot see, and it has already changed once.
 */

import { describe, expect, it } from 'vitest'
import type { RestorePlan } from '@jojo/service/core/backup'
import { DECLINED_MESSAGE, actionFor, recordAnswer } from './receive-decision'
import type { SheetAnswer } from './receive-decision'

const PLAN = {
  exportedAt: '2026-08-26T09:00:00.000Z',
  nodes: [],
  edges: [],
  documents: [],
} satisfies RestorePlan

/** Replays a run of handler calls the way the panel's functional setState does. */
const after = (...events: ('closed' | 'confirmed')[]): SheetAnswer =>
  events.reduce<SheetAnswer>(recordAnswer, 'unanswered')

describe('the Replace button, which fires both handlers', () => {
  it('applies the backup and does not decline it', () => {
    const action = actionFor(after('closed', 'confirmed'), PLAN)

    expect(action).toEqual({ kind: 'apply', plan: PLAN })
  })

  it('never produces the "nothing was changed" message on a confirm', () => {
    // The exact sentence that was on screen while the phone was being replaced.
    const action = actionFor(after('closed', 'confirmed'), PLAN)

    expect(action.kind === 'decline' ? action.message : null).toBeNull()
  })

  it('holds the confirm whatever order the two handlers arrive in', () => {
    expect(after('confirmed', 'closed')).toBe('confirmed')
    expect(after('closed', 'confirmed')).toBe('confirmed')
    // A second close after the decision is still not a way to un-confirm.
    expect(after('closed', 'confirmed', 'closed')).toBe('confirmed')
  })
})

describe('the Cancel button, which fires one', () => {
  it('declines with the sentence the panel shows, and writes nothing', () => {
    const action = actionFor(after('closed'), PLAN)

    expect(action).toEqual({ kind: 'decline', message: DECLINED_MESSAGE })
  })

  it('is what a backdrop tap and the Android back button do too', () => {
    // Both reach `onClose`; neither may be mistaken for agreement.
    expect(after('closed', 'closed')).toBe('declined')
  })
})

describe('an answer with nothing to answer about', () => {
  it('waits rather than repainting over a transfer that already landed', () => {
    // A stray close arriving after the restore started must not put "Nothing was
    // changed." over the Transfer complete screen.
    expect(actionFor('declined', null)).toEqual({ kind: 'wait' })
    expect(actionFor('confirmed', null)).toEqual({ kind: 'wait' })
  })

  it('waits while the sheet is still open and untouched', () => {
    expect(actionFor('unanswered', PLAN)).toEqual({ kind: 'wait' })
  })
})
