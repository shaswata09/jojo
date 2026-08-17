/**
 * The shared `Driver` contract, over this app's driver.
 *
 * The contract itself is `@jojo/service/storage/driver-conformance` and names no
 * driver; this file is the half that does. It stayed in web for the reason the
 * whole storage split exists — `fake-indexeddb/auto` is a browser shim, and a
 * package that mobile also imports may not depend on one.
 *
 * `fake-indexeddb/auto` gives the subject a real implementation — transactions,
 * key ordering and structured cloning included — so "every shipped driver
 * agrees" is a claim about behaviour rather than about a mock.
 */

import 'fake-indexeddb/auto'
import type { StoreEvent } from '@jojo/service/storage/driver'
import { describeDriverConformance } from '@jojo/service/storage/driver-conformance'
import { createIdbDriver } from './idb-driver'

/**
 * A fresh database per subject construction, for the same reason
 * `idb-driver.test.ts` does it: a counter rather than a clock, because
 * `check-platform.mjs` bans the wall clock in this layer and a test whose
 * fixture depends on when it ran is a test that fails on someone else's machine.
 */
let sequence = 0

describeDriverConformance({
  label: 'idb-driver',
  // A loopback channel rather than a BroadcastChannel: Node delivers between
  // two drivers in one process, which is not a thing two browser tabs would do
  // to each other here. `post` fans out to this driver's own subscribers,
  // which a real BroadcastChannel never does — harmless, because nothing in the
  // contract both posts and listens in the same test.
  crossTab: true,
  make: () => {
    const listeners = new Set<(event: StoreEvent) => void>()
    const deliver = (event: StoreEvent) => {
      for (const fn of [...listeners]) fn(event)
    }
    const driver = createIdbDriver({
      name: `conformance-${String((sequence += 1))}`,
      channel: {
        crossTab: true,
        post: deliver,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => listeners.delete(fn)
        },
        close: () => listeners.clear(),
      },
    })
    return { driver, remoteCommit: deliver }
  },
})
