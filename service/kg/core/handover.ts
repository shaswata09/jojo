/**
 * How far this device has drifted from the copy it last handed over.
 *
 * ## The problem
 *
 * Transfer is one-directional, manual and on demand: records move onto a phone
 * over a camera handshake, and nothing moves back. That is a platform fact — a
 * browser cannot accept an inbound connection — and the README says so honestly.
 * What was missing is that nothing in the app ever mentioned the CONSEQUENCE:
 * add a record on the laptop and another on the phone, and you have two stores
 * that can never be reconciled, because the only merge available is a restore,
 * which replaces everything.
 *
 * Divergence you can see is a different thing from divergence you discover. This
 * is the seeing.
 *
 * ## What it is not
 *
 * It is not sync, and nothing here pretends otherwise. It answers one question —
 * "how out of date is the other one?" — from two facts this store already has:
 * when the last handover was, and what has been written since. Answering it does
 * not need a network, an account, or the other device to be reachable.
 */

import type { Instant } from './model'
import { daysBetween } from './dates'
import { dayOf } from './project'

export type HandoverStatus =
  | { state: 'never' }
  | {
      state: 'clean' | 'drifted'
      at: Instant
      /** Local midnights between the handover and now — see `handoverStatus`. */
      days: number
      /** Writes recorded on this device since the handover. */
      writes: number
    }

/** Enough of a journal entry to be counted. */
type Written = { at: Instant }

/**
 * The status, from the handover stamp and the journal.
 *
 * `days` counts LOCAL MIDNIGHTS, not elapsed time — the reason is at the line
 * itself, and it is the difference between "today" being a description and
 * "today" being wrong.
 *
 * `writes` counts JOURNAL ENTRIES, which are user actions rather than records:
 * one entry can create an application, its employer and its deadline in a single
 * commit, and reporting three would overstate the drift. "Eleven things you did"
 * is what a person can check against their own memory; "twenty-nine rows" is not.
 *
 * Any write at all makes it `drifted`. There is no threshold, because there is
 * no number of unsynced changes that is safe to round to zero — the point of the
 * signal is that the other device is behind, and it is behind by one as truly as
 * by fifty.
 */
export function handoverStatus(
  handoverAt: Instant | null,
  journal: readonly Written[],
  now: Instant,
): HandoverStatus {
  if (handoverAt === null) return { state: 'never' }

  const since = Date.parse(handoverAt)
  const writes = journal.filter((e) => Date.parse(e.at) > since).length

  return {
    state: writes > 0 ? 'drifted' : 'clean',
    at: handoverAt,
    // MIDNIGHTS CROSSED, not elapsed 24-hour blocks.
    //
    // This was `floor((now - since) / 86_400_000)` — elapsed milliseconds cut
    // into whole days — and `handoverSentence` below spends that number on
    // "today", "yesterday" and "N days ago", which are calendar words. The two
    // measures part company at every midnight: measured on a transfer made at
    // 23:00 and read at 01:00, two hours later, the elapsed count was 0 and the
    // panel said "Last transfer today" about something done the previous night.
    // The panel exists to be believed about divergence; a sentence that is
    // flatly false about WHEN is worse than one that is vague about HOW LONG.
    //
    // The cost is the case the old comment defended: six and a half elapsed days
    // spanning seven midnights now reads "7 days ago" rather than "6". That is
    // not a rounding error, it is the same shift from duration to calendar —
    // the transfer WAS seven days back on the calendar, which is how a person
    // reading "when did I last send this" checks it against their own memory.
    // The clamp survives for a clock that has moved backwards.
    days: Math.max(0, daysBetween(dayOf(handoverAt), dayOf(now))),
    writes,
  }
}

/**
 * The status as a sentence, so both platforms say the same thing.
 *
 * Deliberately states the drift as a fact rather than as a warning. Working on
 * two devices between transfers is a normal thing to do and the app has no
 * business scolding somebody for it — what it owes them is the number, before
 * they hand over and overwrite it.
 */
export function handoverSentence(status: HandoverStatus): string {
  if (status.state === 'never') {
    return 'This device has never been in a transfer, so nothing has a copy of these records but this.'
  }

  const when =
    status.days === 0
      ? 'today'
      : status.days === 1
        ? 'yesterday'
        : `${String(status.days)} days ago`

  if (status.state === 'clean') {
    return `Last transfer ${when}, and nothing has been written here since — the other device is holding the same records.`
  }

  // "1 change have been made" is the sentence a plural-only template writes.
  const changes =
    status.writes === 1
      ? 'one change has been made here since'
      : `${String(status.writes)} changes have been made here since`
  return `Last transfer ${when}, and ${changes}. The other device is that far behind.`
}
