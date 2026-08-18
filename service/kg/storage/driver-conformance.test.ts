/**
 * The contract over the one driver that needs no platform.
 *
 * `memory-driver` is the reference implementation and the only subject this
 * package can supply: the other two are an IndexedDB driver and an AsyncStorage
 * driver, and a package imported by both apps may depend on neither browser nor
 * React Native. So this file is deliberately three lines, and the interesting
 * two subjects live with the platforms that can build them —
 * `web/src/kg/storage/idb-conformance.test.ts` and
 * `mobile/src/kg/storage/rn-conformance.test.ts`.
 *
 * It is not redundant with `memory-driver.test.ts`. That file pins what only
 * this driver does — the synchronous seam, the injectable failures, the
 * unsubscribe. This one asserts it answers the same contract the shipped
 * drivers do, and it is the subject that makes a contract regression fail here
 * first, in the package that owns it, rather than in whichever app runs next.
 */

import { createMemoryDriver } from './memory-driver'
import { describeDriverConformance } from './driver-conformance'

describeDriverConformance({
  label: 'memory-driver',
  crossTab: true,
  make: () => {
    const driver = createMemoryDriver()
    return { driver, remoteCommit: (event) => driver.emitRemoteCommit(event) }
  },
})
