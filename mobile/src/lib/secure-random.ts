/**
 * Making sure the phone's random numbers are actually random.
 *
 * `react-native-get-random-values` installs `crypto.getRandomValues`, which
 * React Native does not ship — and which `@jojo/service/crypto/noble-secrets`
 * needs before this device can pair with anything.
 *
 * ## Why the import is not enough on its own
 *
 * That package contains a `Math.random()` fallback. It is a real code path —
 * `insecureRandomValues()` in its `index.js` — taken when the native module
 * cannot be called synchronously, and it announces itself with a `console.warn`
 * and nothing else.
 *
 * For the library's usual customer, `uuid`, that is a reasonable default: an id
 * from `Math.random` collides no more often in practice and nothing is trusting
 * it. For a pairing key it is the worst failure this codebase can produce. The
 * handshake succeeds. The transfer completes. Both screens show what they should
 * show. And the bytes are readable by anyone who reproduces a `Math.random`
 * sequence, with no symptom at any point.
 *
 * The New Architecture already disables that path — the package returns early
 * when `RN$Bridgeless` is true, and it is true in this app. This does not depend
 * on that. "Should not fire" is the reasoning that lets things fire, and the
 * cost of being wrong here is not proportional to the cost of the check.
 *
 * ## What it does instead
 *
 * Asks the registry whether the native module is really there, and if it is not,
 * makes `crypto.getRandomValues` ABSENT.
 *
 * Absent, and specifically not a function that throws. The first version of this
 * file installed a thrower and that was a bug that would have taken the app down
 * on every launch. `@jojo/service`'s `core/ref.ts` selects its random source with
 * `typeof source.getRandomValues === 'function'` and no `try`/`catch`, so a
 * throwing function is strictly worse there than a missing one: it passes the
 * check, throws inside `uuidv7()`, and takes `mintNodeId()` and every record
 * creation with it. `ref.ts` says so in its own comment — "a boot that threw
 * here would take the whole app down over a random number" — and a thrower is
 * exactly how that happens.
 *
 * Absence gives both layers the behaviour they were each written for, with no
 * coordination between them:
 *
 *   - `core/ref.ts` sees no function and falls back to `Math.random`. Correct:
 *     ids need to not collide, and they are not a secret.
 *   - `@noble` checks `globalThis.crypto` on EVERY call and throws
 *     "crypto.getRandomValues must be defined". `noble-secrets` re-labels that
 *     as `SecretsUnavailable`, `canPair()` reports false, and the screen can say
 *     this device cannot pair.
 *
 * So the app still runs, still records applications, and refuses exactly one
 * feature — which is the outcome worth having.
 */

import { TurboModuleRegistry } from 'react-native'

/** The native module `react-native-get-random-values` registers. */
const NATIVE_MODULE = 'RNGetRandomValues'

/**
 * Call once at startup, AFTER importing `react-native-get-random-values`.
 *
 * Returns whether the generator can be trusted, so a caller can log or surface
 * it — but the guarantee does not depend on anyone reading the return value.
 * The global is already made to throw by the time this returns false.
 */
export function guardSecureRandom(): boolean {
  // `get`, not `getEnforcing`: the enforcing variant throws, and a throw here
  // would take the app down at import time over a feature most people never
  // open. The whole point is to degrade to "cannot pair", not to "cannot start".
  if (TurboModuleRegistry.get(NATIVE_MODULE) !== null) return true

  /*
   * `defineProperty` rather than assignment or `delete`, and each choice matters.
   *
   * Assignment (`globalThis.crypto = {}`) throws `TypeError: Cannot assign to
   * read only property` wherever the host defined the global with a getter or
   * without `writable` — which Node does, and a future React Native may. A guard
   * that throws while installing itself leaves the insecure generator exactly
   * where it was, which is worse than having no guard.
   *
   * `delete` looks like the natural way to make something absent and is not
   * enough: it removes an OWN property, so where `getRandomValues` is inherited
   * from a prototype — Node's `Crypto`, and any future native implementation —
   * the inherited one is simply revealed again. Defining an own `undefined`
   * shadows the prototype as well, which is the only version that holds in both
   * shapes.
   */
  if (typeof globalThis.crypto !== 'object' || globalThis.crypto === null) {
    Object.defineProperty(globalThis, 'crypto', {
      value: {},
      writable: true,
      configurable: true,
    })
  }
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    value: undefined,
    writable: true,
    configurable: true,
  })
  return false
}
