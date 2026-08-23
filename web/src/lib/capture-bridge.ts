import { useCallback, useEffect, useRef, useState } from 'react'
import {
  readCapture,
  type CaptureEnvelope,
  type CaptureRejection,
} from '@jojo/service/core/capture'

/**
 * The app's end of the conversation with the capture extension.
 *
 * Two windows and one content script, and the shape is dictated by what a page
 * is allowed to know: `chrome.runtime` does not exist here, and the extension's
 * id is not stable for an unpacked load, so the only channel is
 * `window.postMessage` to ourselves and a relay that the extension injected.
 * `web/extension/bridge.js` is the other half.
 *
 * ## Three states, not two
 *
 * "No extension installed", "extension installed with nothing queued" and
 * "captures waiting" want three different sentences, and the first two are
 * indistinguishable from a silent channel — a message posted to a window with no
 * listener does not fail, it simply never answers. So the relay announces itself
 * on load (`jojo:capture-ready`) and every request carries a timeout. Present
 * and quiet is a different fact from absent, and the UI is allowed to say so.
 *
 * ## The trust boundary
 *
 * Everything arriving here crossed `postMessage` from a content script that is
 * itself relaying an extension, and a `message` listener on `window` will hear
 * from anything on the page. So: the source has to be this window, the origin
 * has to be ours, and every envelope goes through `readCapture` — the same
 * function the phone's captures pass through — before anything is filed. A
 * rejected capture is reported rather than dropped, because a user who pressed
 * the button and got nothing deserves the reason.
 */

const REQUEST = 'jojo:capture-request'
const REPLY = 'jojo:capture-reply'
const READY = 'jojo:capture-ready'

/** How long a relay gets to answer before it is treated as absent. */
const TIMEOUT_MS = 400

export type CaptureInbox = {
  /** Whether the relay answered at all. `null` until the first probe settles. */
  installed: boolean | null
  /** How many captures are waiting, as of the last probe. */
  pending: number
  /**
   * The installed extension's version, or null when nothing answered.
   *
   * An unpacked extension never auto-updates — there is no update channel for
   * one — so this is the only way a user learns theirs is older than the app
   * expects. It costs one field in the handshake and pays for itself the first
   * time the capture format changes.
   */
  version: string | null
  /**
   * Reads everything queued, WITHOUT emptying it.
   *
   * The queue used to be cleared by the read, and a capture this side then
   * refused was already gone — the user saw "could not be kept" with nothing
   * left to retry. Deletion is now `ack`, which names what was actually filed.
   */
  collect: () => Promise<{
    ok: { capture: CaptureEnvelope; id: string }[]
    refused: CaptureRejection[]
  }>
  /** Tells the extension which captures were filed, so it can drop those and keep the rest. */
  ack: (ids: string[]) => Promise<void>
  /** Re-asks how many are waiting. */
  refresh: () => void
}

type Reply = {
  type: string
  id: number
  captures?: unknown[]
  count?: number
}

let nextId = 1

/** One round trip, or null when nothing answers in time. */
function ask(take: boolean, acked?: string[]): Promise<Reply | null> {
  return new Promise((resolve) => {
    const id = nextId++
    let settled = false

    const done = (value: Reply | null) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onMessage)
      window.clearTimeout(timer)
      resolve(value)
    }

    const onMessage = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as Reply | null
      if (typeof data !== 'object' || data === null) return
      if (data.type !== REPLY || data.id !== id) return
      done(data)
    }

    const timer = window.setTimeout(() => done(null), TIMEOUT_MS)
    window.addEventListener('message', onMessage)
    window.postMessage({ type: REQUEST, id, take, ack: acked }, window.location.origin)
  })
}

export function useCaptureInbox(): CaptureInbox {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(0)
  const [version, setVersion] = useState<string | null>(null)
  /** Guards against a probe that resolves after the component has gone. */
  const alive = useRef(true)

  const refresh = useCallback(() => {
    void ask(false).then((reply) => {
      if (!alive.current) return
      setInstalled(reply !== null)
      setPending(reply?.count ?? 0)
    })
  }, [])

  useEffect(() => {
    alive.current = true

    // The relay announces itself on load, which may be before or after this
    // mounts — so listen for it AND probe, rather than choosing one and being
    // wrong half the time.
    const onReady = (event: MessageEvent) => {
      if (event.source !== window || event.origin !== window.location.origin) return
      const data = event.data as { type?: string; version?: string } | null
      if (data?.type !== READY) return
      if (typeof data.version === 'string') setVersion(data.version)
      refresh()
    }
    window.addEventListener('message', onReady)
    refresh()

    /*
     * Re-probed on a timer as well as on the announce, because of what the user
     * is physically doing during an install: they are in another tab, on
     * chrome://extensions, and this tab is in the background. A single probe at
     * mount decides "not installed" before the extension exists and never looks
     * again, so the page would still read "not installed" after a successful
     * install — which reads as a broken install rather than a stale probe.
     *
     * Ten seconds is slow enough to cost nothing and fast enough that the flip
     * lands while the user is still looking at the page they installed from.
     */
    const poll = window.setInterval(refresh, 10000)

    // The user leaves to capture something and comes back; the count changed
    // while the tab was hidden and nothing here would otherwise know.
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive.current = false
      window.clearInterval(poll)
      window.removeEventListener('message', onReady)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const collect = useCallback(async () => {
    const reply = await ask(true)
    const ok: { capture: CaptureEnvelope; id: string }[] = []
    const refused: CaptureRejection[] = []

    for (const raw of reply?.captures ?? []) {
      const read = readCapture(raw)
      if (typeof read === 'string') {
        refused.push(read)
        continue
      }
      // The id is the extension's handle, not part of the envelope the package
      // validates — carried alongside so `ack` can name exactly what was filed.
      const id = (raw as { id?: unknown }).id
      ok.push({ capture: read, id: typeof id === 'string' ? id : '' })
    }

    return { ok, refused }
  }, [])

  const ack = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await ask(false, ids)
  }, [])

  return { installed, pending, version, collect, ack, refresh }
}
