/**
 * The complete list of globals the portable layers are allowed to name.
 *
 * `tsconfig.core.json` and `tsconfig.react.json` compile `kg/{core,repo,
 * tools,react}` with `"lib": ["ES2023"]` and no `@types` at all, which is what
 * makes `document.querySelector` in `core/validate.ts` a `tsc` error rather than
 * a lint opinion. That removes DOM's ambient declarations wholesale — and DOM is
 * also where TypeScript happens to declare several things that are not DOM at
 * all. `console` is the obvious one: it exists in every browser, in Node, and in
 * Hermes, and `kg/log.ts` is the only place a dropped record can announce itself
 * in an app with no server to report to. Deleting the lib would have deleted
 * that too.
 *
 * So the names below are re-declared, deliberately and one at a time. Each had
 * to be defensible on all three targets jojo claims — web, React Native /
 * Hermes, and Electron — and each is narrowed to the shape the portable code
 * actually uses, so this file grants a capability rather than re-opening `lib.
 * dom.d.ts` under another name.
 *
 * This file is NOT under `kg`, and that is load-bearing — more so since the
 * extraction than before it. Both apps compile this package's source through
 * their own programs, under their own libs, and web's `tsconfig.app.json`
 * includes `src` wholesale and keeps DOM. A copy of these declarations inside
 * `kg` would therefore be dragged into web's app program and collide with
 * `lib.dom.d.ts` on every one of them — "Subsequent variable declarations must
 * have the same type" — and the fix someone reaches for under that error is to
 * widen the shapes back to DOM's.
 *
 * The corollary is worth stating because it is the one thing about this package
 * that works by luck: since this file is in NO program but the three under
 * `service/tsconfig*.json`, the apps type-check this package's source with
 * `console`, `structuredClone` and the timers resolving from their own DOM lib
 * instead. Those shapes happen to be compatible. `npm -w @jojo/service exec tsc
 * -b` is the check; an app's clean `tsc` is not.
 *
 * Before adding another: check-platform.mjs is the other half of this rule, and
 * it bans by identifier, per layer. A name declared here that is on its ban list
 * for the layer using it is still a lint failure, which is the correct order of
 * operations — the type system says "this exists on every platform", the guard
 * says "not in this layer". The timers at the bottom are the live example.
 */

/**
 * Web, Node and Hermes all have it; `kg/log.ts` uses exactly these three.
 * Narrowed rather than aliased to DOM's `Console` because `console.table` and
 * friends are not universal and a portable layer should not reach for them.
 */
declare var console: {
  log(...data: readonly unknown[]): void
  warn(...data: readonly unknown[]): void
  error(...data: readonly unknown[]): void
}

/**
 * Read off `globalThis` behind a `typeof === 'function'` test in `core/ref.ts`,
 * with a Math.random fallback, so an embedded WebView or an old Hermes without
 * WebCrypto degrades instead of throwing. Declared optional to keep that guard
 * mandatory: drop the check and this is a compile error, which is the whole
 * point of typing the port rather than the platform.
 */
declare var crypto:
  | {
      getRandomValues?<T extends ArrayBufferView>(array: T): T
    }
  | undefined

/**
 * Not a DOM API despite where TypeScript declares it — Node 17+, and Hermes from
 * RN 0.73. `storage/memory-driver.ts` clones every row in and out so a caller
 * cannot mutate the store through a value it was handed. The RN floor is a line
 * for the release notes, not a layer violation.
 */
declare function structuredClone<T>(value: T): T

/**
 * `core/parse-posting.ts` depends on `new URL()` THROWING on garbage, which is
 * the whole of its URL validation. Present on all three platforms; RN's built-in
 * is non-conformant, and the fix for that is `react-native-url-polyfill/auto` in
 * the RN entry file — an app-shell line, not a core edit.
 *
 * Only the members the parser reads. A URL is a bag of thirteen fields and
 * declaring all of them here would invite the layer to use them.
 */
declare class URL {
  constructor(url: string, base?: string)
  readonly href: string
  readonly hostname: string
  readonly host: string
  readonly pathname: string
  readonly protocol: string
  readonly search: string
  readonly searchParams: {
    get(name: string): string | null
    has(name: string): boolean
  }
  toString(): string
}

/**
 * The scheduler. `repo/queue.ts` backs off between failed drains and cancels
 * that backoff when an explicit flush arrives — durability work, and correct on
 * all three platforms with the same signature.
 *
 * This is where the type system stops being able to draw the line and
 * check-platform.mjs takes over. `setTimeout` is not a portability hazard, it is
 * a DETERMINISM hazard, and it is banned in core and tools for that reason and
 * allowed in repo and react. `lib` is per project and core, repo and tools share
 * one, so a config cannot express "repo only" without splitting the pure layers
 * into three projects to encode a rule that has nothing to do with portability.
 * The guard bans it by layer instead, and its message says which layer and why.
 *
 * The handle is opaque on purpose. DOM says `number`, @types/node says a
 * `Timeout` object with `.unref()`, and RN says something else again; code that
 * commits to any of the three stops compiling on the other two. `queue.ts` holds
 * it as `ReturnType<typeof setTimeout> | null` and only ever passes it back,
 * which is the portable way to hold a timer.
 */
type PortableTimer = { readonly __portableTimer?: never }

declare function setTimeout(handler: () => void, timeoutMs?: number): PortableTimer
declare function clearTimeout(timer: PortableTimer | null | undefined): void
declare function setInterval(handler: () => void, timeoutMs?: number): PortableTimer
declare function clearInterval(timer: PortableTimer | null | undefined): void
declare function queueMicrotask(callback: () => void): void
