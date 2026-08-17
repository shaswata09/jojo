import { AppState } from 'react-native'
import type { Host } from '@jojo/service/react/host'

/** One shared no-op unsubscribe, matching `headlessHost`'s. */
const unsubscribe = () => {}

/**
 * What React Native supplies to the graph.
 *
 * The seam is `kg/react/host.ts`, which spells out what each method is for and
 * — unusually — what this file should do about it. What follows is that, plus
 * what turned out to be true once it was written.
 *
 * **`onUndoRequest` gives nothing, on purpose.** There is no ⌘Z on a phone. Undo
 * here is an affordance rather than a chord: every destructive write in this app
 * already raises a toast with an Undo action, and `runtime.undo()` is public on
 * `KgContext` for anything that wants it directly. A host that invented a
 * gesture for it would be adding a second, invisible way to revert on a platform
 * where the visible one is already on screen.
 *
 * **`onSuspend` is the one that matters.** The write queue is write-behind and
 * drains on a microtask, so at any instant there may be one batch the user has
 * watched land on screen that is not on disk yet. On the web that batch is
 * exposed for the length of a tab close; here it is exposed for as long as the
 * OS takes to kill a backgrounded app, which can be hours later and without
 * warning. `AppState` firing `'background'` is the last moment we are certainly
 * still running.
 *
 * Note what `kg/react/host.ts` warns about and this cannot fix: React Native
 * throttles timers in the background, so the queue's own retry backoff will not
 * fire there. The flush on suspend is the belt; the timer is the braces, not the
 * other way round.
 *
 * **`onResume` is supplied even though the doc calls it optional.** It is
 * optional for a platform with nothing to resume from, and this looked like one
 * — a phone runs a single instance, so no other writer can have touched the
 * store. But `repo/boot.ts` subscribes to it only when the store reports
 * `crossTab: false`, which the RN driver always does, and the work it does there
 * is re-reading what is on disk. That is worth doing after a long background:
 * the OS may have killed and restarted the process between the two events, and
 * a resume that assumes memory survived is a resume that can show a stale graph.
 */
export const nativeHost: Host = Object.freeze({
  onUndoRequest: () => unsubscribe,

  onSuspend(run: () => Promise<void>) {
    const sub = AppState.addEventListener('change', (state) => {
      // `'inactive'` as well as `'background'`: iOS passes through it on the way
      // to the app switcher, and a user who swipes up and kills the app from
      // there never generates a `'background'` we get to act on.
      if (state === 'background' || state === 'inactive') void run()
    })
    return () => sub.remove()
  },

  onResume(run: () => void) {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') run()
    })
    return () => sub.remove()
  },
})
