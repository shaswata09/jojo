import { usePriorityActions as usePriorityDeck } from '@jojo/service/react/use-priority'
import type { PriorityAction } from '@jojo/service/react/use-priority'
import type { Addressable } from '@jojo/service/core/address'

/**
 * The phone's import path for the priority deck.
 *
 * The implementation is `@jojo/service/react/use-priority`. It moved down
 * because choosing which three records are worth a decision today — and what
 * sentence goes on each — is a reading of the store, not a fact about a
 * browser or a phone, and this file was a 203-line copy of it that nothing
 * tested. The shared hook's own header says it "is not an abstraction written
 * ahead of its consumer: the second consumer already exists and already
 * disagrees here", and that second consumer is this file. It was still a copy.
 *
 * TWO THINGS CHANGE, AND BOTH ARE THE POINT.
 *
 * `today` now comes from `KgProvider` rather than from the module-level `TODAY`
 * this file used to read. The deck already took `thisWeek` from `useTimeline`,
 * which buckets against the provider's day, so a copy reading its own frozen
 * constant measured the buckets against one day and the colours against
 * another. They can only disagree in a session left open across midnight — and
 * a phone process is the one that stays resident for days.
 *
 * And the destination is an id rather than a route. That is the single field
 * the shared hook takes as an argument, for exactly this reason: the web
 * answers with a URL from `appPath`, and there are no URLs here.
 */

export type { PriorityAction }

/** The colour vocabulary the deck's cards key off. Three values, from the date. */
export type { DateMark as PriorityUrgency } from '@jojo/service/core/timeline-view'

/**
 * Where an application lives on this platform: the record's id, which is what
 * `navigation.navigate('ApplicationDetail', …)` takes.
 *
 * A module function, so the reference is stable and the hook's `useMemo` still
 * holds across renders.
 */
const appTarget = (a: Addressable) => a.id

export function usePriorityActions(): PriorityAction[] {
  return usePriorityDeck({ appHref: appTarget })
}
