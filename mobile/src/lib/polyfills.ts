/**
 * What the browser has and Hermes does not.
 *
 * Imported first thing in `index.ts`, before `App` — and therefore before
 * anything under `@jojo/service` — can be evaluated. Three entries.
 *
 * Both were being supplied by Expo until the ejection. `Expo.fx`, the
 * side-effecting module that `registerRootComponent` pulled in, installed a
 * spec-compliant `URL`, `URLSearchParams`, `structuredClone` and `TextDecoder`
 * before any app code ran. Dropping `expo` from `index.ts` took that away
 * silently: nothing here fails to compile without them, and no test can see it
 * in either direction because vitest runs on Node, where both already exist and
 * are correct.
 */

/**
 * **`URL`** — not a missing global. A wrong one, which is worse.
 *
 * React Native ships a `URL`, so there is nothing for a `typeof` guard to
 * notice. Its implementation is regex-based and **never throws**: `new
 * URL('not a url at all')` succeeds and reports `protocol: ''`, and
 * `https://boards.greenhouse.io/acme/jobs/4` round-trips with a trailing slash
 * added.
 *
 * `@jojo/service`'s `core/parse-posting.ts` is built on the throw. Its
 * `parseUrl()` tries the pasted string as-is, catches, retries it with a scheme,
 * and catches again — those two `catch` blocks *are* its validation. Against a
 * `URL` that never throws, pasting a job title into the posting field stops
 * being rejected and gets stored as a link. `service/types/portable-globals.d.ts`
 * writes that requirement down and names this exact import as the fix; here is
 * where it gets honoured. `src/lib/urls.ts` — `hostOf`, `hostOrNothing`,
 * `isOpenableUrl`, `openHref` — leans on the same behaviour.
 *
 * `/auto` rather than calling `setupURLPolyfill()` by hand: the auto entry
 * checks `Platform.OS !== 'web'` first, so it is a no-op wherever the platform
 * already has the real thing.
 *
 * Deliberately not guarded the way `structuredClone` is below. A guard tests for
 * presence, and the global being replaced here is present.
 */
import 'react-native-url-polyfill/auto'

/**
 * **`structuredClone`** — genuinely absent.
 *
 * The storage layer clones every row on the way in and on the way out, so that a
 * caller holding a returned row cannot reach back into the store through it.
 * That is the right guarantee and it is not this app's to change:
 * `memory-driver.ts` is `@jojo/service`, the same file the web app runs. But
 * `structuredClone` is a browser global that React Native 0.81 does not ship
 * and Hermes does not implement. Without this the app
 * builds, boots, and throws `ReferenceError` on the first read of the store,
 * which is every launch.
 *
 * The polyfill is deliberately the JSON round-trip rather than a full structured
 * clone. It is exact for what actually passes through here: `StoredRow` is
 * `{ [k: string]: unknown }` holding the JSON that goes to AsyncStorage, so
 * anything the real algorithm supports and JSON does not — `Date`, `Map`, `Set`,
 * cycles, typed arrays — could not have survived being persisted either. A
 * fuller implementation would be more correct in general and identical here,
 * while inviting callers to store things the driver cannot save.
 *
 * Guarded rather than assigned: Hermes may grow this, and overwriting a native
 * implementation with a weaker one is how a polyfill outlives its usefulness and
 * becomes the bug.
 */
if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = (<T>(value: T): T =>
    value === undefined
      ? value
      : (JSON.parse(JSON.stringify(value)) as T)) as typeof structuredClone
}

/**
 * **`crypto.getRandomValues`** — absent, and the one global that must never be
 * approximated.
 *
 * React Native 0.81.5 ships no `crypto` object at all, so `globalThis.crypto` is
 * `undefined` on the phone. That is why `@jojo/service`'s `core/ref.ts` mints
 * node ids from `Math.random` here — which its own comment argues is fine,
 * correctly, because "ids only need to not collide, they are not a secret".
 *
 * Key material is the opposite case, and `kg/crypto/noble-secrets.ts` depends on
 * this being real: a pairing key drawn from `Math.random` produces a handshake
 * that SUCCEEDS, a transfer that COMPLETES, and bytes anyone who reproduces the
 * sequence can read. Nothing on either screen would look wrong.
 */
import 'react-native-get-random-values'
import { guardSecureRandom } from '@/lib/secure-random'

/**
 * And the guard, which is the point of this entry rather than the import above.
 *
 * The package ships a `Math.random()` fallback that announces itself with a
 * `console.warn` and nothing else. `guardSecureRandom` checks whether the native
 * module is really there and makes the global throw if it is not, so this device
 * refuses to pair rather than pairing with predictable keys. Its own file
 * carries the full reasoning, and a test.
 */
guardSecureRandom()

export {}
