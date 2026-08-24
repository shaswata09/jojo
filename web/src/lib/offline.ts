/**
 * Registering the service worker that lets jojo open with the network down.
 *
 * The worker itself is `dist/sw.js`, written at build time by
 * `scripts/make-sw.mjs` — which carries the reasoning for what it caches and
 * why it is hand-written. This is only the handshake.
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

  void navigator.serviceWorker.register(swUrl(), { scope: import.meta.env.BASE_URL }).catch(() => {
    /* See the header: every failure here leaves a working online app. */
  })
}
