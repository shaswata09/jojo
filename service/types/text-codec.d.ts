/**
 * `TextEncoder` and `TextDecoder`, granted to `kg/storage` alone.
 *
 * These are NOT in `portable-globals.d.ts`, and the omission is the point. That
 * file's rule is that every name in it is defensible on all three targets jojo
 * claims — web, React Native/Hermes, and Electron. These two are not: React
 * Native 0.81 ships no `TextEncoder` (checked: no declaration in
 * `react-native/types`, none in `react-native/Libraries`), so an app that wants
 * one installs a polyfill in its entry file. Declaring them alongside `console`
 * and `structuredClone` would put a false portability claim in the one file
 * whose entire job is to make that claim honestly.
 *
 * They are needed because `storage/memory-file-store.ts` and
 * `storage/file-store-conformance.ts` turn strings into bytes. Both are test
 * apparatus: the in-memory double for the `FileStore` port, and the port's
 * conformance suite. Neither has an importer outside `kg/storage`, and the port
 * itself has no shipping adapter yet — so nothing that runs on a phone reaches
 * either of them today. They compiled in web only because `kg/storage` used to
 * carry the DOM lib for the IndexedDB driver's sake, and that lib left with the
 * driver.
 *
 * The rule this file therefore encodes, for whoever writes the React Native
 * `FileStore` adapter: the adapter may not use these. It gets bytes from
 * `expo-file-system`, which hands back base64 or a `Uint8Array` directly. If a
 * real, shipping storage module ever needs UTF-8 conversion, the answer is an
 * injected codec on the port — the same shape the clock and the driver already
 * took — not a wider grant here.
 *
 * Narrowed to the three members actually called, so the grant cannot quietly
 * broaden into streams, fatal-mode decoding or encoding labels.
 */

declare class TextEncoder {
  encode(input?: string): Uint8Array
}

declare class TextDecoder {
  decode(input?: ArrayBufferView | ArrayBuffer): string
}
