/**
 * What the browser has and Hermes does not.
 *
 * Imported first thing in `index.ts`, before anything under `src/kg` can be
 * evaluated. One entry so far.
 *
 * **`structuredClone`.** The storage layer clones every row on the way in and on
 * the way out, so that a caller holding a returned row cannot reach back into
 * the store through it. That is the right guarantee and it is web's, unchanged —
 * `memory-driver.ts` is a byte-for-byte copy — but `structuredClone` is a
 * browser global that React Native 0.81 does not ship and Hermes does not
 * implement. Without this the app builds, boots, and throws `ReferenceError` on
 * the first read of the store, which is every launch.
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

export {}
