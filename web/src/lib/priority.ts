/**
 * The web import path for the priority deck.
 *
 * The implementation is `@/kg/react/use-priority`. It moved down because
 * choosing which three records are worth a decision today — and what sentence
 * goes on each — is a reading of the store, not a fact about a browser, and
 * because this file was one of the modules the phone kept in step by copying it
 * across. The project's own notes list `lib/priority.ts` among the two that
 * "diverge on purpose", on precisely the field this shim now supplies.
 *
 * That field is where an application LIVES: a route string here, a screen and a
 * param on a phone. `appPath` is bound in once, at the only place that knows the
 * app has URLs. It is a module function, so the reference is stable and the
 * hook's `useMemo` still holds across renders.
 *
 * `relativeLabel` stays exported from here because `priority.test.ts` walks it
 * against `whenLabel` across a range of offsets, and both sides of that
 * comparison have to be measured against the same day — `TODAY`, which nothing
 * under `service/kg` may import (D26).
 */

import {
  relativeLabelOn,
  usePriorityActions as usePriorityDeck,
} from '@jojo/service/react/use-priority'
import { appPath } from '@/lib/links'
import { TODAY } from '@/lib/today'

export type { PriorityAction } from '@jojo/service/react/use-priority'

/** `relativeLabelOn`, measured against the app's today. */
export const relativeLabel = (iso: string) => relativeLabelOn(TODAY, iso)

export function usePriorityActions() {
  return usePriorityDeck({ appHref: appPath })
}
