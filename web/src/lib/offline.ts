/**
 * Registering the service worker that lets jojo open with the network down.
 *
 * The worker itself is `dist/sw.js`, written at build time by
 * `scripts/make-sw.mjs` — which carries the reasoning for what it caches and
 * why it is hand-written. This is the registration, and the page's half of the
 * update handshake (`handshake` below).
 *
 * NOTHING HERE BLOCKS THE APP. Registration is fire-and-forget and every failure
 * is swallowed: a browser with service workers disabled, a private window, an
 * origin that is not secure, a corporate policy. All of those are a jojo that
 * works exactly as it did before and does not open offline, which is not a
 * reason to show anybody an error.
 */

/**
 * The scope and the script both come from `BASE_URL`.
 *
 * Vite sets it to `/` locally and to `/jojo/` on Pages, and a worker may only
 * control paths under its own directory — so a worker registered at the origin
 * root would control nothing on Pages, and one registered under the base with a
 * root scope would be refused outright.
 */
const swUrl = () => `${import.meta.env.BASE_URL}sw.js`

/**
 * In development, take one AWAY if it is there.
 *
 * The hazard is real and quiet: `vite preview` and `vite dev` both serve
 * localhost, and ports get reused. A worker registered by a preview of the
 * built app will happily serve that build's cached `index.html` to the next dev
 * session on the same port — which looks exactly like edits not taking effect,
 * for as long as it takes somebody to think of the cache. Unregistering here
 * costs nothing in a session that never had one.
 */
async function unregisterInDev(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations()
  await Promise.all(registrations.map((r) => r.unregister()))
  if ('caches' in globalThis) {
    const names = await caches.keys()
    await Promise.all(names.filter((n) => n.startsWith('jojo-')).map((n) => caches.delete(n)))
  }
}

/**
 * The scripts and stylesheets this document is running, as absolute URLs.
 *
 * The service worker reads these to tell which build a window runs: every file
 * under `assets/` carries a content hash, so the set names exactly one build.
 * Vite's runtime-inserted preloads for lazy routes are included, which is right
 * — they are this build's too.
 */
function runningAssets(): string[] {
  const out: string[] = []
  for (const el of document.querySelectorAll(
    'script[src], link[rel="modulepreload"][href], link[rel="stylesheet"][href]',
  )) {
    const url = el instanceof HTMLScriptElement ? el.src : (el as HTMLLinkElement).href
    if (url) out.push(url)
  }
  return out
}

/**
 * The page's half of the update handshake. The worker's half, and why it
 * exists, is the 'message' listener in `scripts/make-sw.mjs`.
 *
 * Two messages, and their shapes are a protocol between builds — a window of
 * this build will be asked by workers from builds not written yet, and asks
 * workers that were — so change them only by adding:
 *
 * - `jojo:which-build`, from a worker, with a port: answer on the port with
 *   `{ assets }`. A worker deciding whether to take over asks every window.
 * - `jojo:take-over`, to a WAITING worker, with `{ assets }`: "I am running
 *   your build". The worker checks that, then takes over only if every other
 *   window says the same.
 *
 * Offered when a worker is found waiting at load, when one finishes
 * installing, and when this tab comes back into view — the usual moment just
 * after the person closed the other tab that was holding the update back.
 */
function handshake(registration: ServiceWorkerRegistration): void {
  const offer = () => {
    registration.waiting?.postMessage({ type: 'jojo:take-over', assets: runningAssets() })
  }
  const watch = (worker: ServiceWorker | null) => {
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') offer()
    })
  }
  offer()
  watch(registration.installing)
  registration.addEventListener('updatefound', () => {
    watch(registration.installing)
  })
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') offer()
  })
}

/**
 * Called once, from `main.tsx`, after the app has been handed to React.
 *
 * After rather than before on purpose: an install fetches the whole precache
 * list, and doing that while the first paint is still competing for the network
 * makes the page slower to become useful in exchange for an offline copy nobody
 * needs in the first two seconds.
 */
export function startOffline(): void {
  if (!('serviceWorker' in navigator)) return

  if (import.meta.env.DEV) {
    void unregisterInDev().catch(() => {
      /* Nothing to clean up, or the browser will not say. Either is fine. */
    })
    return
  }

  // Answered before registering, so a worker that is already deciding whether
  // to take over hears from this window too.
  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: unknown } | null
    if (data?.type === 'jojo:which-build') event.ports[0]?.postMessage({ assets: runningAssets() })
  })
  // A worker's messages are queued until this is called or the document has
  // loaded; startOffline runs after render, so this is belt and braces.
  navigator.serviceWorker.startMessages()

  void navigator.serviceWorker
    .register(swUrl(), { scope: import.meta.env.BASE_URL })
    .then(handshake)
    .catch(() => {
      /* See the header: every failure here leaves a working online app. */
    })
}
