/**
 * Enforces that the portable layers stay portable: no DOM, no Node, no clock.
 *
 * jojo ships on web, on React Native and inside Electron, and the service layer
 * — core, repo, tools and the React bindings — is supposed to be the same code
 * on all three. Nothing enforced that. Back when these layers lived in the web
 * app, their tsconfig extended the app's, which sets `"lib": ["ES2023", "DOM"]`,
 * so `window.addEventListener` compiled clean; `check-layers.mjs` matches module specifiers, and a global is
 * not an import, so it never looked. That is how a `window` listener sat inside
 * `kg/react/kg.tsx` — the one layer that is supposed to be shareable with React
 * Native — through a build that passed `tsc -b`, `npm test` and `npm run lint`.
 * On RN that line is not a type error anyone reviews, it is a `ReferenceError`
 * at mount.
 *
 * Platform behaviour enters through a port instead: `Driver`
 * (kg/storage/driver.ts) for durability, `Host` (kg/react/host.ts) for the
 * things the graph needs a platform to tell it, `ToastContextValue`
 * (kg/react/toast.ts) for the things it needs a platform to say. Adapters live
 * in each app — `web/src/lib` and `web/src/kg/storage`, `mobile/src/lib` — which
 * are platform-specific and allowed to be.
 *
 * Since then the type system carries the same rule: `tsconfig.core.json` and
 * `tsconfig.react.json` compile those layers with `"lib": ["ES2023"]` and no
 * ambient @types, so `document.querySelector` in `core/validate.ts` fails `tsc`
 * as well as this script. That does not retire the file — a lib setting is per
 * PROJECT and this guard is per LAYER, which is the difference between "no
 * setTimeout anywhere under kg" and "no setTimeout in core and tools, where
 * it is a determinism bug, but yes in repo, where a retry backoff belongs". The
 * type system also cannot see an import edge: see DOM_MODULES below.
 *
 *
 * PARSED, NOT GREPPED
 *
 * That is the whole reason this is a second file rather than twenty more lines
 * in `check-layers.mjs`. A regex over identifiers cannot tell `window.foo` from
 * `props.location`, from `{ location: 'Austin' }`, from the word "document" in
 * a tool summary, or from "a private-browsing window" in a doc comment — and
 * this codebase has all four: of 28 naive-grep hits under kg, 23 are prose
 * or domain nouns. A first cut with comment and string stripping got the false
 * positives down but not out, and it needed a scanner that handles template
 * literals, nested `${}`, JSX text and the regex-literal-versus-division
 * ambiguity; getting any of those wrong silently swallows the rest of a file, so
 * the guard would fail OPEN on the one file it mis-scanned and nobody would ever
 * know. A portability rule that fires on `application.location` is a rule
 * someone suppresses rather than obeys. TypeScript is already a devDependency
 * and already runs in `npm run build`, so parsing costs no new dependency.
 *
 * The syntax tree is used WITHOUT a type checker: no program, no module
 * resolution, one `createSourceFile` per file. The question is "does this file
 * name a platform API", which is answered by shape, and a full program would
 * make lint pay for a typecheck the build already does. It runs in ~0.4s.
 *
 * A name is reported only when it is a FREE IDENTIFIER IN A REFERENCE POSITION:
 * not a property (`props.location`), not a declaration name, not an object key,
 * not a string, not a comment, not JSX text, and NOT BOUND ANYWHERE IN THE FILE.
 * That last clause is what lets the ban list stay honest. Without it, `location`
 * and `Buffer` have to come off the list outright — `tools/runtime.ts:102`
 * declares a local `type Buffer` and passes `buf: Buffer` seven times, and
 * `const { location } = props` is a plain identifier read — and dropping them
 * means the real globals of those names can never be caught at all. Collecting
 * the file's own bindings first costs 30 lines and keeps both names banned with
 * zero false positives across all 63 files. See `boundNames` below.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

/*
 * The package root, not the app root. These two guards used to live in
 * `web/scripts/` and derived their root the same way, and mobile's copy of
 * `src/kg` was therefore never scanned by either of them — 18 layer and 5
 * platform violations went unreported for as long as the copy existed. They now
 * sit beside the only tree there is, and both apps invoke them through
 * `npm -w @jojo/service run lint`.
 */
const SERVICE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/*
 * The repo root, because the third target below is not in this package. The one
 * file that implements a kg port outside `service/` is the React Native driver,
 * and it was never scanned by anything.
 */
const ROOT = path.resolve(SERVICE, '..')

/**
 * Every app in the workspace. See `check-no-copies.mjs`, which carries the
 * reason all three guards stopped naming their two apps by hand.
 */
function appRoots() {
  const manifest = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const names = Array.isArray(manifest.workspaces) ? manifest.workspaces : []
  return names
    .filter((name) => name !== 'service')
    .map((name) => path.join(ROOT, ...name.split('/'), 'src'))
    .filter((dir) => existsSync(dir))
}

/**
 * Why each group is banned, and what to reach for instead.
 *
 * The message matters as much as the check. A guard that says "banned
 * identifier: window" gets satisfied by deleting the guard. A guard that names
 * the platform that breaks and the seam that already exists gets satisfied by
 * using the seam, which is the outcome worth having.
 */
const GROUPS = {
  dom: {
    what: 'a browser/DOM global',
    breaks:
      'React Native, where it is a ReferenceError at mount rather than a type error at review, and the Electron main process',
    use: 'the Host port (kg/react/host.ts), implemented in src/lib — or move the code up into src/lib or src/components, where web-only already lives. A keystroke and a caret position are not graph state. If the shared layer needs the capability rather than the implementation, bring the INTERFACE down and leave the web pieces up: kg/react/toast.ts is the worked example, and src/lib/toast-context.ts is what stayed behind',
  },
  node: {
    what: 'a Node global or built-in module',
    breaks: 'every browser and every React Native bundle, neither of which can even resolve it',
    use: 'the Driver port (kg/storage/driver.ts) — the one layer allowed to know what it is running on',
  },
  net: {
    what: 'a network API',
    breaks:
      'nothing outright, but this app never fetches; a domain layer that can reach the network is a domain layer that can block, fail and leak',
    use: 'nothing. If a Wave ever needs the network it arrives as an injected port, the same way the clock and the driver did',
  },
  timer: {
    what: 'a scheduler',
    breaks:
      'determinism and testability. Not portability — setTimeout exists on all three platforms with the same signature, which is exactly why this ban is narrow: core and tools only',
    use: 'return the delay and let the caller schedule it. core and tools are pure functions of their inputs; a layer that can wait is a layer whose tests need fake timers. repo IS allowed a timer — queue.ts backs off between failed drains, which is durability work and belongs there',
  },
  clock: {
    what: 'a wall-clock read',
    breaks:
      'determinism, on every platform equally. The demo today is pinned to the seed October; a tool that read the clock stamped a completion ten months after every label on screen',
    use: 'ToolContext.now (D26), injected at the provider. `new Date(instant)` and `Date.parse(instant)` are fine — it is the zero-argument forms that invent a time out of nothing',
  },
}

/**
 * The banned names, one line each.
 *
 * Deliberately a denylist, not "any free identifier outside an ES allowlist".
 * The allowlist version catches strictly more, and it also has to enumerate
 * every ES global anyone might reasonably use — miss `Reflect` or
 * `AggregateError` and the guard cries wolf on correct code, which is the
 * failure mode this file exists to avoid. Add a line when a global becomes
 * reachable.
 *
 * Deliberately ABSENT, and each was considered rather than forgotten:
 *
 * - `URL` / `URLSearchParams`: core/parse-posting.ts depends on `new URL()`
 *   THROWING on garbage, and all three platforms have it. RN's built-in one is
 *   non-conformant, but the fix is `react-native-url-polyfill/auto` in the RN
 *   entry file — an app-shell line, not a core edit. Banning it here would ask
 *   core to solve a problem core cannot see.
 * - `globalThis` / `crypto`: core/ref.ts reads `globalThis.crypto` behind a
 *   `typeof === 'function'` test with a Math.random fallback, so Hermes degrades
 *   instead of throwing. The guarded read IS the portable form.
 * - `structuredClone`: not a DOM API — Node 17+, and Hermes from RN 0.73 — so
 *   banning it would be a portability claim this file cannot back up. The three
 *   uses in storage/memory-driver.ts are an RN version floor for the release
 *   notes, not a layer violation.
 * - `Date` itself: `new Date(injectedInstant)` is the CORRECT way to use one.
 *   The two clock-reading forms are matched structurally in `wallClockRead`.
 */
const BANNED = new Map(
  Object.entries({
    // Browser globals.
    window: 'dom',
    document: 'dom',
    navigator: 'dom',
    location: 'dom',
    history: 'dom',
    screen: 'dom',
    self: 'dom',
    localStorage: 'dom',
    sessionStorage: 'dom',
    indexedDB: 'dom',
    IDBKeyRange: 'dom',
    BroadcastChannel: 'dom',
    matchMedia: 'dom',
    getComputedStyle: 'dom',
    requestAnimationFrame: 'dom',
    cancelAnimationFrame: 'dom',
    requestIdleCallback: 'dom',
    alert: 'dom',
    confirm: 'dom',
    customElements: 'dom',
    MutationObserver: 'dom',
    ResizeObserver: 'dom',
    IntersectionObserver: 'dom',
    Notification: 'dom',
    DOMParser: 'dom',
    XMLSerializer: 'dom',
    caches: 'dom',
    // DOM types and constructors. Listed as well as the globals above because a
    // type annotation is coupling too: `target: EventTarget` compiles fine on RN
    // and then hands you a value the annotation lied about.
    HTMLElement: 'dom',
    HTMLInputElement: 'dom',
    HTMLTextAreaElement: 'dom',
    Element: 'dom',
    Document: 'dom',
    Node: 'dom',
    NodeList: 'dom',
    Event: 'dom',
    EventTarget: 'dom',
    KeyboardEvent: 'dom',
    MouseEvent: 'dom',
    PointerEvent: 'dom',
    FocusEvent: 'dom',
    CustomEvent: 'dom',
    DragEvent: 'dom',
    ClipboardEvent: 'dom',
    Blob: 'dom',
    File: 'dom',
    FileList: 'dom',
    FileReader: 'dom',
    FormData: 'dom',
    DataTransfer: 'dom',
    Image: 'dom',
    Audio: 'dom',
    Worker: 'dom',
    Selection: 'dom',
    DOMRect: 'dom',
    ShadowRoot: 'dom',
    // Node globals.
    process: 'node',
    Buffer: 'node',
    __dirname: 'node',
    __filename: 'node',
    require: 'node',
    module: 'node',
    global: 'node',
    setImmediate: 'node',
    // Network.
    fetch: 'net',
    XMLHttpRequest: 'net',
    WebSocket: 'net',
    EventSource: 'net',
    Request: 'net',
    Response: 'net',
    Headers: 'net',
    // Schedulers. core and tools only — see GROUPS.timer.
    setTimeout: 'timer',
    setInterval: 'timer',
    clearTimeout: 'timer',
    clearInterval: 'timer',
    queueMicrotask: 'timer',
    // Clock.
    performance: 'clock',
  }),
)

/**
 * Node's own modules, which no browser and no RN bundle can resolve.
 *
 * `check-layers.mjs` already bans ALL packages in `core` and `log`, but `repo`,
 * `tools`, `storage` and `react` are allowed third-party imports — that is how
 * `idb` gets into the driver in Wave 2 — so nothing there would have stopped
 * `import { readFileSync } from 'node:fs'` landing in a tool. This is the one
 * platform coupling that IS an import, so it is checked as one.
 */
const NODE_MODULES = new Set([
  'assert',
  'buffer',
  'child_process',
  'cluster',
  'console',
  'constants',
  'crypto',
  'dgram',
  'dns',
  'domain',
  'events',
  'fs',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'punycode',
  'querystring',
  'readline',
  'repl',
  'stream',
  'string_decoder',
  'sys',
  'timers',
  'tls',
  'trace_events',
  'tty',
  'url',
  'util',
  'v8',
  'vm',
  'wasi',
  'worker_threads',
  'zlib',
])

const isNodeModule = (spec) =>
  spec.startsWith('node:') || NODE_MODULES.has(spec) || NODE_MODULES.has(spec.split('/')[0])

/**
 * The browser's half of the same idea: platform coupling that arrives as an
 * import rather than as an identifier.
 *
 * Checked here rather than left to the type system because the type system
 * cannot express it. `tsconfig.react.json` sets `"types": ["react"]`, and
 * `types` governs which @types packages are injected as GLOBALS — an explicit
 * `import { createPortal } from 'react-dom'` resolves through node_modules
 * regardless, and compiles clean under `"lib": ["ES2023"]` because @types/react
 * ships empty stub interfaces for the DOM names it needs. Dropping DOM from the
 * lib was necessary and is not sufficient; this list is the rest of it.
 *
 * - `react-dom` is a RENDERER, not React. It is the one package whose whole
 *   purpose is that the tree ends up in a document, so it is the exact import
 *   that turns "the hooks travel" from true into false. RN renders through
 *   react-native, Electron's main process renders nothing.
 * - `@/lib` and `@/components` are jojo's web app. `check-layers.mjs` used to
 *   allow `kg/react -> @/lib` because the toast context lived there; the
 *   interface moved to `kg/react/toast.ts` and only the web adapter stayed —
 *   `ToastViewport`, a CSS selector, and a focus helper typed `HTMLElement`.
 *   Importing that module back into the shared layer is the original violation
 *   returning by the same door, and it does not produce a type error: the empty
 *   `HTMLElement` stub means the ANNOTATION still checks. Only the call would
 *   fail, and there is no call — which is what makes this worth a lint rule.
 *   The grant in `check-layers.mjs` is gone now, so the two files agree; this
 *   one is still the load-bearing half, because it also covers `react-dom`.
 *
 * Prefix-matched, so `react-dom/client` and `@/lib/utils` are covered without
 * enumerating them, and `@/data` — pure fixtures, allowed by check-layers in
 * repo, tools and react — is not caught by accident.
 */
const DOM_MODULES = ['react-dom', '@/lib', '@/components']

const isDomModule = (spec) =>
  DOM_MODULES.some((banned) => spec === banned || spec.startsWith(`${banned}/`))

/**
 * Which rules apply where.
 *
 * Per layer, not one flat rule over kg, because the layers genuinely differ.
 * `kg/storage` is the adapter layer: `indexedDB` and `BroadcastChannel` are its
 * JOB, and a guard that banned them would fail `idb-driver.ts` the day Wave 2
 * writes it — a gate that blocks the correct implementation gets deleted, and
 * takes the rules that were right with it. What storage does NOT get is the
 * clock, because D26 is about determinism rather than portability and a driver
 * that stamps its own timestamps breaks replay exactly like a tool would.
 */
const TARGETS = [
  {
    root: path.join(SERVICE, 'kg'),
    /** 'core/model.ts' -> 'core'; 'log.ts' -> 'log'. */
    layerOf: (rel) => {
      const first = rel.split(path.sep)[0]
      return first.endsWith('.ts') ? path.basename(first, '.ts') : first
    },
    layers: {
      core: ['dom', 'node', 'net', 'timer', 'clock'],
      tools: ['dom', 'node', 'net', 'timer', 'clock'],
      /*
       * The strictest list, and `net` is the one that matters.
       *
       * The agent layer is the one place in this package that exists BECAUSE of
       * a network call, so the temptation to let it make one is real and the ban
       * is what keeps the design honest: `loop.ts` takes the model call as a
       * function its caller supplies, which is why a scripted test can prove the
       * cap holds without a socket. The day this list gains `net` is the day the
       * loop stops being testable.
       *
       * `clock` too. A trace that stamped its own steps would be a trace that
       * cannot be replayed, and D26 already says where time enters.
       */
      agent: ['dom', 'node', 'net', 'timer', 'clock'],
      log: ['dom', 'node', 'net', 'timer', 'clock'],
      // No `timer`: repo owns durability, and durability means retry. queue.ts
      // backs off between failed drains and cancels that backoff when an
      // explicit flush arrives. Correct on all three platforms — the RN caveat
      // is that a backgrounded app coalesces the timer, which is a reason to
      // flush on suspend through Host, not a reason to delete the backoff.
      repo: ['dom', 'node', 'net', 'clock'],
      // React Native is React, so the hooks travel — but only if they never
      // touch a document. `timer` is allowed: a hook may legitimately debounce.
      react: ['dom', 'node', 'net', 'clock'],
      storage: ['clock'],
    },
  },
  {
    /*
     * Not a kg layer, but `repo/seed.ts` and `tools/memory.ts` import it, so it
     * is reachable from the model and gets the model's rules.
     *
     * It started with `clock` alone: a `new Date()` behind the `@/data` alias is
     * a wall-clock read reachable from a tool without the tool ever naming Date,
     * which is the D26 hole `todayISO()` sat in until that rule went live. The
     * other three were left off on the grounds that the fixtures are "pure
     * fixtures and pure date maths" — which described the code but not the
     * guarantee. Nothing stopped a `document.querySelector` landing here.
     *
     * The type system did not cover it either, and that half is closed now by
     * the layout rather than by this file. `tsconfig.core.json` used to reach
     * only the six fixture modules kg happened to import; it names the whole
     * `data` directory today. `statistics.ts` and `calendar.ts` were the two
     * nobody compiled at kg strictness — reached by no kg module, so web's
     * `tsconfig.app.json` was the only project that saw them, DOM in the lib and
     * `vite/client` in the types. They are `kg/core/statistics.ts` and
     * `kg/core/calendar.ts` now. What they had picked up in the meantime came
     * with them: eight `noUncheckedIndexedAccess` errors, no DOM.
     *
     * No `timer`. Nothing here schedules anything today, but a fixture module is
     * not where determinism is won or lost, and `repo` — the layer that reads
     * these — is allowed a timer for its retry backoff. Adding it would be a rule
     * with no failure behind it.
     */
    root: path.join(SERVICE, 'data'),
    layerOf: () => 'data',
    layers: { data: ['dom', 'node', 'net', 'clock'] },
  },
  {
    /*
     * The React Native adapter, which lives in `mobile/` and is checked from
     * here.
     *
     * `kg/storage` inside the package gets `['clock']` alone, because
     * `indexedDB` and `BroadcastChannel` are that layer's JOB and a guard that
     * banned them would fail the driver it exists to protect. This target is
     * the same layer on a platform where the opposite holds: AsyncStorage is
     * the platform API here, and `localStorage` or `node:fs` appearing in an RN
     * driver is not an adapter doing adapter work, it is a browser assumption
     * that will be a ReferenceError at mount. So `dom`, `node` and `net` come
     * back on, and `clock` stays on for the reason it is on everywhere — a
     * driver that stamps its own timestamps breaks replay exactly like a tool
     * would.
     *
     * `timer` stays off. A driver may legitimately coalesce or debounce a
     * flush, which is durability work, and `repo` is allowed a timer for its
     * retry backoff for the same reason.
     */
    root: path.join(ROOT, 'mobile', 'src', 'kg'),
    layerOf: () => 'adapter',
    layers: { adapter: ['dom', 'node', 'net', 'clock'] },
  },
  {
    /*
     * The web adapters — the IndexedDB driver, the cross-tab channel, the
     * storage probe — which live in `web/` and are checked from here.
     *
     * This entry exists because the restructure MOVED the fork's precondition
     * instead of removing it, and that was measured rather than argued: with
     * only the three targets above, prepending `const _stamp = Date.now()` and
     * an import of the L1 domain model to `web/src/kg/storage/idb-driver.ts`
     * left `npm -w web run lint` exiting 0. The identical pair inside mobile's
     * `rn-driver.ts` failed BOTH apps. Before the move web's driver was guarded
     * and mobile's was not; after it, exactly the reverse. Half a guard is how
     * the 813-line fork accumulated in the first place.
     *
     * `dom` is deliberately NOT banned: `indexedDB` and `BroadcastChannel` are
     * this layer's whole job, and a rule that banned them would fail the driver
     * it exists to protect. That is the same reasoning as `kg/storage` inside
     * the package, and the mirror image of the RN entry above, where the DOM is
     * the browser assumption rather than the job.
     *
     * `clock` stays banned for the reason it is banned everywhere — a driver
     * stamping its own timestamps breaks replay exactly like a tool would.
     * `node` and `net` are banned because neither belongs in a browser adapter.
     * `timer` stays allowed: coalescing a flush is durability work.
     */
    root: path.join(ROOT, 'web', 'src', 'kg'),
    layerOf: () => 'adapter',
    layers: { adapter: ['node', 'net', 'clock'] },
  },
]

/**
 * Known violations that a named piece of in-flight work is about to delete.
 *
 * This is the one dangerous idea in the file, so it is built to expire. An entry
 * that stops matching is itself a FAILURE — "you fixed it, now delete this line"
 * — so the list cannot quietly outlive its reason and become the suppression
 * file every guard eventually grows. Keyed by identifier, not by file, so half a
 * fix un-exempts half the entry.
 *
 * It is empty, and it shipped empty. Its first and only tenant would have been
 * `useUndoHotkey` in kg/react/kg.tsx — `window.addEventListener` plus an
 * `instanceof HTMLElement` — and the Host port work removed that before this
 * guard landed, so the staleness rule deleted the entry on its first run. The
 * mechanism stays because the alternative, invented under deadline by whoever
 * this guard first blocks, is an `eslint-disable`-shaped comment with no expiry.
 *
 * If you are about to add a row here to make a build pass: don't. Move the code
 * to src/lib or src/components. That is the fix in every case this reports.
 */
const PENDING = []

/* -------------------------------------------------------------------------- */

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (/\.tsx?$/.test(full)) out.push(full)
  }
  return out
}

/**
 * Every name the file itself binds: imports, declarations, parameters, type
 * parameters, catch variables, destructured locals.
 *
 * Consulted before anything is reported, and it is the whole false-positive
 * defence. `tools/runtime.ts` says `type Buffer = {...}` and uses it nine times;
 * a projection says `const { location } = props`. Both are the file's own names,
 * and a name the file declares is by definition not the platform's. Without this
 * pass those two identifiers have to be struck off the ban list entirely, which
 * trades nine false positives for two permanent blind spots.
 *
 * It errs toward silence on purpose: shadowing `window` with a local is
 * harmless, and this is a file-level set rather than real scope analysis, so a
 * local `document` in one function silences the whole file. That is the right
 * trade for a lint gate — the cost of a miss is a review comment somebody would
 * have made anyway, the cost of a false positive is the gate being deleted.
 */
function boundNames(source) {
  const bound = new Set()

  const addPattern = (name) => {
    if (!name) return
    if (ts.isIdentifier(name)) {
      bound.add(name.text)
      return
    }
    // `const { a, b: c } = x` — only the local side counts; `b` in `{ b: c }` is
    // a property of the source object and is handled by isNamePosition instead.
    if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) addPattern(element.name)
      }
    }
  }

  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) ||
      ts.isParameter(node) ||
      ts.isBindingElement(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeParameterDeclaration(node) ||
      ts.isImportClause(node) ||
      ts.isNamespaceImport(node) ||
      ts.isImportSpecifier(node)
    ) {
      addPattern(node.name)
    }
    ts.forEachChild(node, visit)
  }

  visit(source)
  return bound
}

/**
 * True when this identifier NAMES something rather than referencing it.
 *
 * `props.location`, `{ location: 'Austin' }`, `location: string` in an
 * interface, `profile.document.add`, `interface Element` — all of these are the
 * word used as a label, and none of them touch a global. Filtering them here is
 * why the guard can be strict without being noisy: every one of the 23 prose and
 * domain-noun hits under kg lands in this function or in `boundNames`.
 *
 * `QualifiedName` is the type-position twin of a property access and is why
 * `JSX.Element` and `React.KeyboardEvent` do not fire.
 *
 * ShorthandPropertyAssignment is pointedly absent: `{ window }` puts the
 * identifier in a `name` slot AND reads it, so it must fall through and be
 * reported rather than be left as a hole someone could walk through.
 */
function isNamePosition(id) {
  const parent = id.parent
  if (!parent) return false
  if (ts.isShorthandPropertyAssignment(parent)) return false

  // `a.b` and `A.B` in type position — the right-hand side is a member.
  if (ts.isPropertyAccessExpression(parent) && parent.name === id) return true
  if (ts.isQualifiedName(parent) && parent.right === id) return true

  // `const { document: doc } = x` — `document` is the source object's property.
  // `import { File as VaultFile }` — `File` is the module's name, not ours.
  if (parent.propertyName === id) return true

  // Anything else whose `.name` slot is this identifier is a declaration or a
  // member: function, class, variable, parameter, type alias, type parameter,
  // property signature, method, enum member, JSX attribute, import specifier.
  if (parent.name === id) return true

  // Labels.
  if (
    (ts.isLabeledStatement(parent) ||
      ts.isBreakStatement(parent) ||
      ts.isContinueStatement(parent)) &&
    parent.label === id
  ) {
    return true
  }

  return false
}

/**
 * The two shapes that read the wall clock.
 *
 * Structural rather than name-based, because `Date` itself is fine — every
 * correct site under kg is `new Date(injectedInstant)`. The difference
 * between correct and forbidden is the argument list, which is exactly the
 * distinction a grep cannot make and a parse gets for free.
 */
function wallClockRead(node, bound) {
  if (bound.has('Date')) return undefined
  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Date' &&
    (node.arguments?.length ?? 0) === 0
  ) {
    return 'new Date()'
  }
  if (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === 'Date' &&
    node.name.text === 'now'
  ) {
    return 'Date.now()'
  }
  return undefined
}

/** The module specifier of an import, an export-from, or a dynamic `import()`. */
function moduleSpecifier(node) {
  if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
    return node.moduleSpecifier
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword &&
    node.arguments[0] !== undefined
  ) {
    return node.arguments[0]
  }
  return null
}

const failures = []
const seen = new Set()

/**
 * Every app's `src/kg` must be named by a TARGETS entry above.
 *
 * TARGETS was four hand-written entries, two of which reach into apps, so an app
 * added to the workspace was simply not scanned — `localStorage` in a third
 * platform's driver would have gone unreported while this script printed its
 * green line. `check-no-copies.mjs` carries the full reason all three guards
 * stopped naming their apps by hand.
 *
 * This one asserts COVERAGE rather than inventing a rule for the new app, and
 * the distinction is the point. The two adapter entries above ban opposite
 * things — `dom` is this layer's job in a browser and a ReferenceError at mount
 * on a phone — so which axes a third adapter may use is a judgement about that
 * platform, not something a default can be right about. Guessing it would
 * produce a rule with no reason written beside it, which is the one thing every
 * entry in this file has.
 */
for (const src of appRoots()) {
  const kg = path.join(src, 'kg')
  if (!existsSync(kg)) continue
  if (TARGETS.some((target) => target.root === kg)) continue
  failures.push({
    rel: path.relative(ROOT, kg),
    line: 1,
    text:
      'is an app adapter directory that no TARGETS entry in check-platform.mjs covers, so nothing ' +
      'here is checked for the wrong platform. Add an entry naming which of dom/node/net/timer/clock ' +
      'this platform bans, and why — the web and React Native entries ban opposite things, so there ' +
      'is no default that is right.',
  })
}

for (const target of TARGETS) {
  for (const file of walk(target.root)) {
    // Package-relative inside `service/`, repo-relative for the adapters, so
    // the printed path is one an editor can open from where lint was run.
    const inPackage = path.relative(SERVICE, file)
    const rel = inPackage.startsWith('..') ? path.relative(ROOT, file) : inPackage
    const layer = target.layerOf(path.relative(target.root, file))
    const groups = target.layers[layer]

    if (!groups) {
      failures.push({
        rel,
        line: 1,
        text: `sits in an unknown layer '${layer}'. Add it to check-platform.mjs TARGETS or move the file.`,
      })
      continue
    }
    if (groups.length === 0) continue

    const text = readFileSync(file, 'utf8')
    const sourceFile = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      // Parent pointers, without which isNamePosition has nothing to look at.
      true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    )
    const bound = boundNames(sourceFile)

    const report = (node, id, group, message) => {
      if (!groups.includes(group)) return
      if (PENDING.some((p) => p.file === rel && p.ids.includes(id))) {
        seen.add(`${rel}::${id}`)
        return
      }
      const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
      failures.push({ rel, line: line + 1, text: message, group, id })
    }

    const visit = (node) => {
      const clock = wallClockRead(node, bound)
      if (clock) report(node, clock, 'clock', `reads the wall clock with \`${clock}\`.`)

      if (ts.isIdentifier(node)) {
        const group = BANNED.get(node.text)
        if (group && !bound.has(node.text) && !isNamePosition(node)) {
          report(node, node.text, group, `references the global \`${node.text}\`.`)
        }
      }

      const spec = moduleSpecifier(node)
      if (spec !== null && ts.isStringLiteral(spec)) {
        if (isNodeModule(spec.text)) {
          report(node, spec.text, 'node', `imports the Node built-in '${spec.text}'.`)
        }
        if (isDomModule(spec.text)) {
          report(node, spec.text, 'dom', `imports the web-only module '${spec.text}'.`)
        }
      }

      ts.forEachChild(node, visit)
    }
    visit(sourceFile)
  }
}

/**
 * A pending entry that no longer matches anything is a fixed violation whose
 * exemption outlived it. Reported as a failure so the list shrinks to zero on
 * its own rather than waiting for someone to notice.
 */
for (const pending of PENDING) {
  for (const id of pending.ids) {
    if (!seen.has(`${pending.file}::${id}`)) {
      failures.push({
        rel: 'scripts/check-platform.mjs',
        line: 1,
        stale: true,
        text: `PENDING exemption for \`${id}\` in ${pending.file} no longer matches anything. The violation is fixed — delete '${id}' from the entry, and the whole entry once its ids are gone.`,
      })
    }
  }
}

if (failures.length > 0) {
  failures.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line)

  console.error(`\ncheck-platform: ${failures.length} portability violation(s)\n`)
  for (const f of failures) console.error(`  ${f.rel}:${f.line}  ${f.text}`)

  for (const key of [...new Set(failures.map((f) => f.group).filter(Boolean))]) {
    const g = GROUPS[key]
    console.error(`\n  ${key.toUpperCase()} — ${g.what}.`)
    console.error(`    Breaks: ${g.breaks}.`)
    console.error(`    Instead: ${g.use}.`)
  }

  if (failures.some((f) => f.stale)) {
    console.error('\n  A stale PENDING entry is not a regression — it means the fix landed.')
  }

  console.error(
    '\nThe rule: kg/core, kg/repo and kg/tools are pure TypeScript, and kg/react is React\n' +
      'and nothing else, because RN is React too. kg/storage is the adapter layer and may\n' +
      'touch the platform — that is its job. jojo mounts this code unchanged inside React\n' +
      'Native and Electron, so a platform API below the seam is a rewrite, not a bug.\n' +
      'See docs/KG-ARCHITECTURE.md §2.\n',
  )
  process.exit(1)
}

console.log(
  'check-platform: kg, data and the platform adapters are free of the wrong platform and of wall-clock reads',
)
