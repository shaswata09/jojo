/**
 * What the person is told when the agent loop had to step in: the app notes
 * (`{ type: 'note', app: true }`) its modules write into a transcript.
 *
 * A leaf on purpose — no value imports at all. The transcript reads a stored
 * note back to its catalog key (`react/app-note.ts`), so the app's boot bundle
 * needs these strings; it must not need the loop. When they lived beside their
 * producers (`budget`, `history`, `round`, `exit`), importing four constants
 * pulled compaction, the budget, the verify gate, stuck detection and the
 * prompt into the boot preload — 32 KB the lazily imported loop was meant to
 * keep off it (review 3). The producers re-export from here, so nothing that
 * imported them changed.
 */

import type { VerifyReason } from './verify-gate'

/** What to tell the person when earlier turns were summarised rather than lost. */
export const summarisedNote = (dropped: number): string =>
  `This conversation grew past what the model can hold, so the earliest ${String(dropped)} message${dropped === 1 ? '' : 's'} ${dropped === 1 ? 'was' : 'were'} replaced with a short summary. The assistant still knows what happened; it no longer has the exact wording.`

/**
 * Said when a run had to shorten its own tool results to keep going.
 *
 * Deliberately not `trimNote`: nothing was dropped and no message left the
 * request, so telling the person their conversation was cut would be wrong.
 * What happened is recoverable and worth naming plainly — the model can read
 * any of it again.
 */
export const stubbedNote = (stubbed: number): string =>
  `This turn grew past what the model can hold, so ${String(stubbed)} earlier tool result${
    stubbed === 1 ? ' was' : 's were'
  } shortened to a summary line. Nothing was lost — the records are still in your store and can be read again.`

/** What to tell the person when earlier turns had to go. */
export const trimNote = (dropped: number): string =>
  `This conversation grew past what the model can hold, so the earliest ${String(dropped)} message${dropped === 1 ? '' : 's'} ${dropped === 1 ? 'was' : 'were'} left out of this request. Your records are untouched — start a new conversation to give it a clean slate.`

/**
 * Told to the person when the tool list alone overflows the window. Stored
 * English; shown translated through `appNoteText` (`react/app-note.ts`), which
 * reads it back by this exact text.
 */
export const TOOLS_OVERFLOW_NOTE =
  'The tool list alone is larger than this model can hold. Narrow what the assistant may reach for, or raise the context window in Settings if your server allows it.'

/**
 * Told to the person when a tool call was cut off by the output limit and the
 * model was asked to send it again. Stored English; shown translated through
 * `appNoteText` (`react/app-note.ts`), which reads it back by this exact text.
 */
export const CUT_CALL_NOTE =
  'The model’s tool call was cut off by its output limit before it was complete, so it was not run. It has been asked to send it again.'

/** Told to the person when a reply stopped at the output limit for good. As `CUT_CALL_NOTE`. */
export const CUT_REPLY_NOTE =
  'The model stopped mid-reply because it hit its own output limit. Anything below this may be incomplete — a shorter question, or a larger reply limit on the server, usually fixes it.'

/**
 * What the PERSON is told when the verification gate sends an answer back.
 *
 * One sentence per reason, because the reasons are not interchangeable and a
 * single generic line would be the least useful of the four. The model gets
 * `verdict.nudge`, which is an instruction in the second person; this is the
 * fact in the third, for the screen.
 *
 * Written to be readable by somebody who does not know a gate exists: it says
 * what the assistant claimed, what the store actually shows, and that a round is
 * being spent on the difference. Somebody who sees this and then sees a correct
 * answer has learned the app checked; somebody who sees it and then sees the
 * same claim again has learned not to trust that claim, which is the whole
 * point.
 */
export const VERIFY_NOTE: Record<VerifyReason, string> = {
  'claimed-write-none-attempted':
    'The assistant said it had changed something, but nothing that writes was called and the store is unchanged. It has been asked to check before finishing.',
  'claimed-write-none-landed':
    'The assistant said it had changed something, but every write it tried this turn failed or was declined, so the store is unchanged. It has been asked to check before finishing.',
  'named-unread-record':
    'The assistant named a record it did not read this turn. It has been asked to look it up before answering, rather than answering from memory.',
  'bare-acknowledgement':
    'The assistant agreed to do the work without doing it, so nothing has happened yet. It has been asked to make the call.',
  'stopped-mid-task':
    'The assistant stopped partway, saying what it would do next without doing it. It has been asked to carry on.',
}
