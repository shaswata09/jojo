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
 * app deliberately serves every asset from its own origin — the Spline scene,
 * the fonts, the sounds each carry a comment saying it is so things work offline
 * — so there is nothing here to fetch from anywhere else. All that was missing
 * was something to keep a copy.
 *
 * ## Why this is written out rather than installed
 *
 * `vite-plugin-pwa` would do it with Workbox underneath. That is a large
 * dependency tree for a policy that is thirty lines, in a repo that hand-rolls
 * its PNG encoder and its base64 codec for the same reason — and a cache policy
 * is exactly the kind of thing you want to be able to read in full when a user
 * reports a stale build. What is below is a precache list, three routing rules
 * and a cleanup.
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
import { dirname, join, posix, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditPrecache, localPath } from './precache-guard.mjs'

const WEB = dirname(dirname(fileURLToPath(import.meta.url)))
const DIST = join(WEB, 'dist')

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
for (const file of files) {
  version.update(file.url)
  version.update(readFileSync(file.full))
  if (boot.has(file.url)) precache.push(file.url)
}
const hash = version.digest('hex').slice(0, 12)

const source = `/*
 * jojo's service worker. GENERATED by web/scripts/make-sw.mjs — do not edit.
 *
 * Three rules and a cleanup. Everything it serves came from this origin, and it
 * never touches a request it did not precache or cannot safely repeat.
 */
const VERSION = ${JSON.stringify(hash)}
const CACHE = 'jojo-' + VERSION

/** Resolved against the worker's own URL, so it is right under '/' and '/jojo/'. */
const INDEX = new URL('index.html', self.location.href).href
/** Wherever the MarkItDown path is served from, under the app or at the root. */
const READER = new URL('reader', self.location.href).pathname
const PRECACHE = ${JSON.stringify(precache, null, 2)}.map(
  (path) => new URL(path, self.location.href).href,
)

self.addEventListener('install', (event) => {
  // No skipWaiting. A new worker takes over on the next load rather than
  // mid-session: swapping the assets under a running build is how a user ends
  // up with this version's HTML asking for last version's chunks.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n.startsWith('jojo-') && n !== CACHE).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
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
   * which is what makes a deep link work with the network down.
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
   * time — which is how the 1.3MB mascot scene becomes available offline
   * without putting it in the install.
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
    `  precached ${String(precached.length)} files the page needs to boot ` +
    `(${kb(precached.reduce((n, f) => n + f.size, 0))})\n` +
    `  ${String(deferred.length)} more cached on first use ` +
    `(${kb(deferred.reduce((n, f) => n + f.size, 0))})`,
)
