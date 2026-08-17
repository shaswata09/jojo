/**
 * L0 — BroadcastChannel wrapper and the StoreEvent shape.
 *
 * Multi-tab is same-origin, same-disk, and a real deadlock risk, so it is in
 * scope. Cross-device is not: no sync protocol, no merge, no vector clocks. The
 * payload is deliberately not a delta — D23 says a remote change is a full
 * rehydrate, because a rehydrate at 100 nodes is ~5 ms and a delta path is a
 * second code path with its own bugs (a delete arriving as an id you then fail
 * to find, and no way to tell that from a record you never had).
 *
 * The event is posted AFTER the write reaches disk, never at commit time. A tab
 * told "something changed" while our queue still holds the ops would read the
 * store, find the old rows, and rehydrate itself back to the state we had just
 * moved on from — and it would look like the other tab's edit had been undone.
 * `idb-driver.ts` posts it from the successful branch of `commit` for that
 * reason.
 *
 * BroadcastChannel does not deliver a message to the context that posted it, so
 * there is no self-echo to filter. That is a guarantee of the API rather than
 * something this file arranges, and it is why `post` takes no sender id.
 */

import type { StoreEvent } from '@jojo/service/storage/driver'

export type { StoreEvent } from '@jojo/service/storage/driver'

export interface Channel {
  post(event: StoreEvent): void
  /** Returns an unsubscribe, matching every other subscription in the codebase. */
  subscribe(fn: (event: StoreEvent) => void): () => void
  close(): void
  /**
   * Whether this channel actually reaches other tabs.
   *
   * False for `nullChannel`, and the app has to know rather than assume. See the
   * note on `nullChannel` for what goes wrong when it assumes.
   */
  readonly crossTab: boolean
}

const unsubscribe = () => {}

/**
 * The channel that carries nothing.
 *
 * Three callers, and none of them is a failure in itself: a runtime with no
 * BroadcastChannel (React Native, Node under test, Safari before 15.4), the
 * in-memory driver, and any test that wants a driver with no cross-tab traffic.
 *
 * This used to say "a missing BroadcastChannel is not a broken app — it is a
 * single-tab app", and that is true of a native shell and false of a browser.
 * A browser with two tabs open and no channel is not one tab: it is two tabs
 * that overwrite each other in silence. D23's protection — flush, rehydrate,
 * clear the undo stack — is driven entirely by this channel, so without it tab A
 * writes a whole record over tab B's edit, and B's undo stack, never cleared,
 * will happily revert A's write using before-images captured minutes ago. Both
 * losses are silent.
 *
 * Hence `crossTab`. `repo/boot.ts` reads it and, when it is false, falls back to
 * re-reading the store whenever the tab is resumed — later than a channel, but
 * bounded, and it clears the stale undo stack at the same time.
 */
export const nullChannel: Channel = Object.freeze({
  post: () => {},
  subscribe: () => unsubscribe,
  close: () => {},
  crossTab: false,
})

/**
 * True when the payload is one of ours.
 *
 * Checked rather than trusted because the channel name is scoped to the origin,
 * not to the build: a tab running yesterday's bundle posts yesterday's shape,
 * and a rehydrate triggered by a message we could not read would be a rehydrate
 * with no idea what it was for. An unreadable message is ignored, which leaves
 * that tab exactly as stale as it was — recoverable — rather than crashing the
 * listener out of the subscription entirely.
 */
function isStoreEvent(value: unknown): value is StoreEvent {
  if (typeof value !== 'object' || value === null) return false
  const event = value as Record<string, unknown>
  return (
    event['kind'] === 'commit' &&
    typeof event['at'] === 'string' &&
    typeof event['entryId'] === 'string'
  )
}

/**
 * A channel over the platform's BroadcastChannel, or the null one.
 *
 * The `typeof` guard is not defensive programming, it is the portability rule:
 * `kg/storage` is the adapter layer and may name a browser global, but the
 * moment it names one unguarded, the same module stops loading under Hermes and
 * in Node. The fallback is silent on purpose — a console warning on every boot
 * of the React Native shell would be noise about a feature that shell does not
 * have.
 */
export function createStoreChannel(name: string): Channel {
  if (typeof BroadcastChannel === 'undefined') return nullChannel

  let channel: BroadcastChannel | null
  try {
    channel = new BroadcastChannel(`${name}:store`)
  } catch {
    // Constructing one throws in a sandboxed frame with an opaque origin. The
    // app still runs there; it is just alone.
    return nullChannel
  }

  const listeners = new Set<(event: StoreEvent) => void>()

  channel.onmessage = (message: MessageEvent<unknown>) => {
    if (!isStoreEvent(message.data)) return
    for (const fn of [...listeners]) fn(message.data)
  }

  return {
    crossTab: true,

    post(event) {
      try {
        channel?.postMessage(event)
      } catch {
        // `postMessage` throws after `close()`, which happens on the
        // `blocking` path: another tab is upgrading, we shut everything down,
        // and a drain that was already in flight lands afterwards. Nobody is
        // listening for that event any more, so there is nothing to recover.
      }
    },

    subscribe(fn) {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },

    close() {
      listeners.clear()
      channel?.close()
      channel = null
    },
  }
}

/*
 * The 50 ms debounce D23 asks for is NOT here, and it looks like it should be.
 *
 * It is `REMOTE_DEBOUNCE_MS` in `repo/boot-live.ts`, next to the rehydrate it
 * protects, because the
 * only consumer is `repo` and `repo` may not import this file. `service/tsconfig.core.json`
 * compiles core, repo and tools with `"lib": ["ES2023"]` and no `@types` at all
 * — no `BroadcastChannel`, no `MessageEvent` — so a helper exported from here
 * drags this module into that program and fails it on the first identifier.
 * Which is the config doing exactly what it was written to do: this layer is
 * allowed to know it is in a browser, and the layer above it is not.
 */
