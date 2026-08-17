/**
 * The shared `Driver` contract, over this app's driver.
 *
 * The contract is `@jojo/service/storage/driver-conformance` and names no
 * driver; this file is the half that does, and after the fork was deleted it is
 * the only test in this package that covers code no other package has. That is
 * the whole argument for it existing in this commit rather than the next one:
 * `rn-driver.ts` is now the single platform-specific file in `mobile/src/kg`,
 * and the file that used to cover it went out with the other 78.
 *
 * It replaces a copy of the contract that lived here and was one generation
 * behind — it had never run web's "stores a row by value, keeping an absent key
 * absent and a null null", which was written FOR an AsyncStorage driver and
 * which this driver passes. Getting that case is the point of inverting the
 * subject list rather than maintaining a third copy of it.
 *
 * AsyncStorage is mocked rather than stubbed to a no-op. The driver's whole job
 * is the round trip through it, and a mock that accepted writes without being
 * readable would pass every assertion in the contract while shipping a store
 * that loses everything on close.
 */

import { beforeEach, vi } from 'vitest'
import { describeDriverConformance } from '@jojo/service/storage/driver-conformance'
import { createRnDriver } from './rn-driver'

/** One string per key, which is all AsyncStorage is. */
const disk = new Map<string, string>()

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: (k: string) => Promise.resolve(disk.get(k) ?? null),
    setItem: (k: string, v: string) => {
      disk.set(k, v)
      return Promise.resolve()
    },
    removeItem: (k: string) => {
      disk.delete(k)
      return Promise.resolve()
    },
  },
}))

// The RN driver writes to one fixed key, so two cases in one run would
// otherwise inherit each other's rows.
beforeEach(() => disk.clear())

describeDriverConformance({
  label: 'rn-driver',
  /*
   * There is no second instance of a phone app reading this store — the driver
   * reports `crossTab: false` from `open()` for the same reason — so the
   * contract runs its unsubscribe half here rather than its delivery half. See
   * `DriverSubject.crossTab`.
   */
  crossTab: false,
  make: () => ({
    driver: createRnDriver(),
    remoteCommit: () => {
      throw new Error('rn-driver has no second writer; crossTab is false.')
    },
  }),
})
