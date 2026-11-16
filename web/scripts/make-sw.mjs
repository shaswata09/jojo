/**
 * Writes `dist/sw.js` — the reason jojo opens with the network down.
 *
 * ## The problem this fixes
 *
 * Every record is in IndexedDB on the user's own machine, and the app said so on
 * nearly every screen — and reloading it offline gave Chrome's dinosaur, because
 * the DOCUMENT still had to come from a server. A local-first app that needs a
 * round trip to open is local-first about storage only. On a plane to a campus
 * visit, which is exactly when the interview schedule is wanted, it was
 * unreachable.
 *
 * Most of the work was already done and unreachable for want of this file. The
 * app deliberately serves every asset from its own origin — the fonts, the
 * sounds, the Transfer scene's textures and the mascot's model each carry a
 * comment saying it is so things work offline — so there is nothing here to
 * fetch from anywhere else. All that was missing was something to keep a copy.
 *
 * ## Why this is written out rather than installed
 *
 * `vite-plugin-pwa` would do it with Workbox underneath. That is a large
 * dependency tree for a policy that is thirty lines, in a repo that hand-rolls
 * its PNG encoder and its base64 codec for the same reason — and a cache policy
 * is exactly the kind of thing you want to be able to read in full when a user
 * reports a stale build. What is below is a precache list, a checked install,
 * an update handshake, three routing rules and a cleanup.
 *
 * ## The version, and why the build hashes it
 *
 * A service worker updates when its own BYTES change. Vite already fingerprints
 * every asset it emits, so a rebuild that changes nothing produces the same file
 * list and must produce the same worker — otherwise every deploy would churn a
 * cache for no reason. Hashing the emitted files gives exactly that: identical
 * output, identical worker; one byte different anywhere, a new cache name and a
 * clean swap.
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auditPrecache,
  belongsToBuild,
  bootMarks,
  indexIsBuild,
  isFingerprinted,
  localPath,
  olderCaches,
  precachedAsset,
} from './precache-guard.mjs'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
// `JOJO_DIST` lets gate.sh check a build made elsewhere without wiping `dist/`.
const DIST = process.env.JOJO_DIST ? resolve(process.env.JOJO_DIST) : join(WEB, 'dist')

/**
 * What has to be in the cache for the app to BOOT with no network.
 *
 * Size is the wrong question and the first draft asked it: a 512KB ceiling left
 * the 1.2MB entry chunk out of the install, so the shell was cached, the script
 * it needs was not, and offline produced a blank page instead of a dinosaur —
 * which is worse, because it looks like the app rather than like the network.
 *
 * The right question is what the DOCUMENT asks for. Vite already answers it: the
 * scripts, stylesheets and modulepreloads it writes into `index.html` are
 * exactly the set needed to reach first paint, and every other chunk is reached
 * later by an import the runtime rule below can catch. So the precache is the
 * document, what the document names, and the handful of files a manifest points
 * at — nothing chosen by weight.
 */
const REFERENCED = /(?:src|href)="([^"]+)"/g

/** The prefix the build wrote into those URLs — '/' locally, '/jojo/' on Pages. */
const BASE = process.env.BASE_PATH ?? '/'

/** Pointed at by the manifest and the shell, and never large. */
const ALWAYS = ['index.html', 'manifest.webmanifest', 'favicon.svg']

/** Never precached: the worker cannot cache itself, and the rest is chaff. */
const SKIP = new Set(['sw.js', '404.html', '.DS_Store'])

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const files = walk(DIST)
  .map((full) => ({
    /** POSIX, because it is going into a URL and Windows builds must not emit backslashes. */
    url: relative(DIST, full).split(sep).join(posix.sep),
    size: statSync(full).size,
    full,
  }))
  .filter((f) => !SKIP.has(f.url))
  .sort((a, b) => a.url.localeCompare(b.url))

const index = files.find((f) => f.url === 'index.html')
if (!index) {
  console.error(
    'make-sw: no dist/index.html.\n' +
      '  This runs after `vite build`, so if the build failed the error above is\n' +
      '  the real one. No service worker was written.',
  )
  process.exit(1)
}

const known = new Set(files.map((f) => f.url))
const boot = new Set(ALWAYS.filter((u) => known.has(u)))

const html = readFileSync(index.full, 'utf8')
for (const [, raw] of html.matchAll(REFERENCED)) {
  const url = localPath(raw, BASE)
  if (url !== null && known.has(url)) boot.add(url)
}

// Every icon the manifest can ask for. Small, and the one thing an installed
// app is guaranteed to want before it has been opened twice.
for (const f of files) if (f.url.startsWith('icons/')) boot.add(f.url)

/*
 * And every lazy chunk but the Transfer scene — see `precachedAsset`. Boot
 * alone was the right test for the FIRST offline load, and wrong for the one
 * after a deploy: a page reached by a lazy import (the graph, the PDF editor)
 * was cached on first use, the next deploy's worker deleted that cache on
 * activate, and the page failed offline until it had been opened online again.
 */
for (const f of files) if (precachedAsset(f.url)) boot.add(f.url)

/*
 * Fail closed: the assets the DOCUMENT names must actually be in that list.
 *
 * `REFERENCED` above stays deliberately permissive — any src or href, so a shell
 * that later gains an <img> keeps being cached without anyone remembering to
 * come here. It is permissive in the wrong direction too: a URL it cannot find
 * on disk is skipped in silence, which is how a build can ship a worker that
 * precaches the shell and none of the code the shell loads. `precache-guard.mjs`
 * carries the measurement; this is where it stops the build.
 */
const broken = auditPrecache({
  html,
  base: BASE,
  boot,
  emittedCss: files.some((f) => f.url.endsWith('.css')),
})
if (broken.length > 0) {
  console.error(
    'make-sw: the precache would not boot the app.\n' +
      broken.map((line) => `  - ${line}`).join('\n') +
      '\n  No service worker was written. One built from this dist would cache the\n' +
      '  shell without the code it loads, which offline is a blank page rather\n' +
      '  than a failed build.',
  )
  process.exit(1)
}

// Content, not mtime: a rebuild that changes nothing has to produce the same
// worker, or every deploy invalidates a cache it had no reason to.
const version = createHash('sha256')
const precache = []
/** Every fingerprinted file of this build, precached or not. See `carry` in the worker. */
const fingerprinted = []
/**
 * The bytes each precached file outside `assets/` should have, by URL. Its
 * name says nothing about its content, so this is how the worker knows whether
 * an earlier cache's copy is still this build's. See `fill` in the worker.
 */
const digests = {}
for (const file of files) {
  const bytes = readFileSync(file.full)
  version.update(file.url)
  version.update(bytes)
  // index.html is installed by its own step, after everything it names.
  if (boot.has(file.url) && file.url !== 'index.html') precache.push(file.url)
  if (isFingerprinted(file.url)) fingerprinted.push(file.url)
  else if (boot.has(file.url)) digests[file.url] = createHash('sha256').update(bytes).digest('hex')
}
const hash = version.digest('hex').slice(0, 12)
const marks = bootMarks(html, BASE)

const source = `/*
 * jojo's service worker. GENERATED by web/scripts/make-sw.mjs — do not edit.
 *
 * An install that checks what it caches, an update that waits until no open
 * window still needs the old build, three routing rules and a cleanup.
 * Everything it serves came from this origin, and it never touches a request
 * it did not precache or cannot safely repeat.
 */
const VERSION = ${JSON.stringify(hash)}
const CACHE = 'jojo-' + VERSION

/** Resolved against the worker's own URL, so it is right under '/' and '/jojo/'. */
const INDEX = new URL('index.html', self.location.href).href
/** Where every fingerprinted file lives. See \`belongsToBuild\`. */
const ASSETS = new URL('assets/', self.location.href).href
/** Wherever the MarkItDown path is served from, under the app or at the root. */
const READER = new URL('reader', self.location.href).pathname
/** Everything installed with the worker except index.html, which goes in last. */
const PRECACHE = ${JSON.stringify(precache, null, 2)}.map(
  (path) => new URL(path, self.location.href).href,
)
/**
 * This build's fingerprinted files. A hashed name is one set of bytes forever,
 * so a copy cached by an earlier worker is still right and is carried over on
 * activate instead of being deleted with that worker's cache — which is how a
 * lazy chunk that is not precached (the Transfer scene) stays offline. It is
 * also how a window is recognised as running this build: see \`belongsToBuild\`.
 */
const CARRY = new Set(${JSON.stringify(fingerprinted)}.map(
  (path) => new URL(path, self.location.href).href,
))
/** SHA-256 of each precached file outside assets/, by URL. */
const DIGESTS = new Map(Object.entries(${JSON.stringify(digests, null, 2)}).map(
  ([path, hex]) => [new URL(path, self.location.href).href, hex],
))
/** What this build's index.html must name. See \`indexIsBuild\`. */
const MARKS = ${JSON.stringify(marks)}

${belongsToBuild.toString()}

${olderCaches.toString()}

${indexIsBuild.toString()}

async function sha256(response) {
  const bytes = await response.clone().arrayBuffer()
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * One precached file into this worker's cache.
 *
 * A fingerprinted file may come from anywhere that has it — an earlier cache,
 * or the browser's HTTP cache — because its name pins its bytes. Every other
 * file is fetched past the HTTP cache: the host sends max-age=600, so within
 * ten minutes of a deploy the default fetch answered with the PREVIOUS build's
 * copy, and the new worker installed it as its own. An earlier cache's copy is
 * reused only when its bytes are this build's, which is what saves the mascot's
 * 1.3 MB from being downloaded again on every deploy.
 */
async function fill(cache, url) {
  if (CARRY.has(url)) {
    const kept = await caches.match(url)
    if (kept) return cache.put(url, kept)
    const response = await fetch(url)
    if (!response.ok) throw new Error(url + ': ' + response.status)
    return cache.put(url, response)
  }
  const want = DIGESTS.get(url)
  for (const name of await caches.keys()) {
    if (!name.startsWith('jojo-') || name === CACHE) continue
    const kept = await (await caches.open(name)).match(url)
    if (kept && want !== undefined && (await sha256(kept)) === want) return cache.put(url, kept)
  }
  const response = await fetch(new Request(url, { cache: 'reload' }))
  if (!response.ok) throw new Error(url + ': ' + response.status)
  return cache.put(url, response)
}

self.addEventListener('install', (event) => {
  // No skipWaiting here: see the 'message' listener for when this worker
  // takes over, and why it has to ask first.
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE)
      await Promise.all(PRECACHE.map((url) => fill(cache, url)))
      /*
       * The document last, and checked. Past the HTTP cache for the reason
       * \`fill\` gives, and then read: a CDN edge that has not caught up with the
       * deploy can still answer with the old one, which names an entry chunk
       * this cache does not hold — offline, a blank page with no error. Failing
       * the install instead keeps the previous worker, whose document and chunks
       * agree, and the browser tries again on the next visit.
       *
       * Last, because a cache holding INDEX is then a cache holding everything:
       * the 'message' listener relies on that.
       */
      const index = await fetch(new Request(INDEX, { cache: 'reload' }))
      if (!index.ok) throw new Error('index.html: ' + index.status)
      if (!indexIsBuild(await index.clone().text(), MARKS)) {
        throw new Error('index.html is not this build’s; the next visit tries again')
      }
      await cache.put(INDEX, index)
    })(),
  )
})

/**
 * Asks one window which build it is running.
 *
 * The window answers with the URLs of its scripts and stylesheets (see
 * \`src/lib/offline.ts\`). Silence counts as another build: a window running a
 * build from before this handshake cannot answer, and neither can one the
 * browser has frozen, and either may still need the old cache.
 */
function askWindow(client) {
  return new Promise((resolve) => {
    const channel = new MessageChannel()
    const timer = setTimeout(() => resolve(null), 2000)
    channel.port1.onmessage = (event) => {
      clearTimeout(timer)
      resolve(event.data && event.data.assets)
    }
    client.postMessage({ type: 'jojo:which-build' }, [channel.port2])
  })
}

/**
 * When a waiting worker takes over.
 *
 * Without this it never did. Navigation is network-first, so a tab kept open
 * across a deploy ran the NEW build on every online reload while the OLD worker
 * stayed active — a reload does not release it — and offline that worker
 * answered with the old index.html. Measured: an older build booted offline
 * against a documents database the newer one had already upgraded, and the
 * Vault showed no documents.
 *
 * Taking over is only safe when no open window needs the old cache. A window
 * still on the old build lazy-loads its chunks from there — the server stopped
 * having them at the deploy — so activating under it deletes code it is about
 * to ask for. So a window running THIS build says so ('jojo:take-over', with
 * its asset URLs), and this worker then asks every window, controlled or not,
 * and calls skipWaiting only if all of them answer with this build.
 *
 * When one does not, this worker keeps waiting but puts its own index.html into
 * every older cache. That is what makes an offline boot open the newest build
 * that ran: whichever worker is active, its fallback finds this document first
 * (\`caches.match\` searches the oldest cache first), the chunks it names are
 * found in this worker's cache, and the window still on the old build never
 * reads index.html again — it only needs its chunks, which are untouched.
 */
self.addEventListener('message', (event) => {
  const data = event.data
  if (!data || data.type !== 'jojo:take-over') return
  if (!belongsToBuild(data.assets, CARRY, ASSETS)) return
  event.waitUntil(
    (async () => {
      const mine = await (await caches.open(CACHE)).match(INDEX)
      // No document means this worker never finished installing.
      if (!mine) return
      const body = await mine.blob()
      for (const name of olderCaches(await caches.keys(), CACHE)) {
        await (await caches.open(name)).put(INDEX, new Response(body, { headers: mine.headers }))
      }
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const answers = await Promise.all(windows.map(askWindow))
      if (answers.every((assets) => belongsToBuild(assets, CARRY, ASSETS))) await self.skipWaiting()
    })(),
  )
})

/** Copies what CARRY names out of an old cache into the new one. */
async function carry(from, into) {
  const old = await caches.open(from)
  for (const request of await old.keys()) {
    if (!CARRY.has(request.url) || (await into.match(request))) continue
    const response = await old.match(request)
    if (response) await into.put(request, response)
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const into = await caches.open(CACHE)
      for (const name of olderCaches(await caches.keys(), CACHE)) {
        // A failed carry only costs a re-fetch later; it must not keep the
        // old cache, or the worker, from being replaced.
        await carry(name, into).catch(() => {})
        await caches.delete(name)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  if (url.origin !== self.location.origin) return

  /*
   * The MarkItDown proxy is somebody else's server behind a same-origin path.
   * Caching a reader response would serve a stale page back as a fresh capture,
   * and answering it from cache while offline would report a fetch that never
   * happened.
   */
  if (url.pathname.startsWith(READER) || url.pathname.startsWith('/reader')) return

  /*
   * A navigation is any address the router might own — '/applications/rice'
   * included, which no server has a file for. Network first so a deployed
   * update is picked up on the next visit, falling back to the cached shell,
   * which is what makes a deep link work with the network down. The shell is
   * the newest that ran: see the 'message' listener.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() =>
        caches.match(INDEX).then((hit) => hit ?? Response.error()),
      ),
    )
    return
  }

  /*
   * Everything else this origin serves is fingerprinted by the build or is a
   * static asset, so a hit is always correct and a miss is filled in for next
   * time — which is how the Transfer scene becomes available offline without
   * putting it in the install.
   */
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit
      return fetch(request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const copy = response.clone()
          void caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
    }),
  )
})
`

writeFileSync(join(DIST, 'sw.js'), source)
const kb = (n) => `${String(Math.round(n / 1024))}KB`
const precached = files.filter((f) => boot.has(f.url))
const deferred = files.filter((f) => !boot.has(f.url))
console.log(
  `make-sw: dist/sw.js written, version ${hash}\n` +
    `  precached ${String(precached.length)} files: the boot set and every lazy chunk but the Transfer scene, the mascot's included ` +
    `(${kb(precached.reduce((n, f) => n + f.size, 0))})\n` +
    `  ${String(deferred.length)} more cached on first use ` +
    `(${kb(deferred.reduce((n, f) => n + f.size, 0))})`,
)
