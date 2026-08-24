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

/**
 * The bridge revision a relayed request needs. See `extension/bridge.js`.
 *
 * Separate from the extension's VERSION, which is pinned and read by people. An
 * unpacked extension never auto-updates, so a browser can hold a bridge that
 * predates a verb indefinitely — and an old bridge does not refuse an unknown
 * shape, it picks the nearest verb it knows. That is how a stale copy turned a
 * model request into a capture peek and produced "Request with GET/HEAD method
 * cannot have body", attributed to the provider.
 *
 * Checked before relaying rather than after failing, so the answer is "reload
 * the extension" instead of a transport error about a server never contacted.
 */
const NEEDS_PROTOCOL = 3

/** Said the same way wherever a stale bridge is found, because the fix is one thing. */
const STALE =
  'The jojo extension loaded in this browser is older than this page and cannot carry the request. ' +
  'Open chrome://extensions and press Reload on jojo — an unpacked extension never updates itself.'

/**
 * How long a relay gets to answer a PROBE before it is treated as absent.
 *
 * Short on purpose: this runs on mount and decides whether to render an install
 * panel, so a slow answer is worse than a wrong one the poll will correct.
 */
const PROBE_TIMEOUT_MS = 400

/**
 * How long a TAKE gets, which is a different question entirely.
 *
 * A take carries every queued capture across `postMessage` — measured at 1–9 MB
 * each — and structured-cloning that is not instant. Reusing the probe's 400 ms
 * meant a realistic queue timed out, the app saw no captures, and the strip went
 * on saying one was waiting: a feature that worked in testing with a 2 KB
 * fixture and never with a real posting.
 */
const TAKE_TIMEOUT_MS = 30000

export type CaptureInbox = {
  /** Whether the relay answered at all. `null` until the first probe settles. */
  installed: boolean | null
  /**
   * True when the extension is present but older than this page needs.
   *
   * Its own state because it wants its own sentence: "install it" and "reload
   * the one you have" are different instructions, and an unpacked extension in
   * the second state can sit there for months.
   */
  stale: boolean
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
    /** Why each was refused, and the id it can be dropped by. */
    refused: { reason: CaptureRejection; id: string }[]
  }>
  /**
   * Tells the extension which captures to drop.
   *
   * Called with what was FILED, and also with what was permanently REFUSED —
   * because the queue only shrinks on this call, and a capture jojo will never
   * accept would otherwise sit there being counted forever, with the strip
   * offering to save it on every visit and failing every time.
   */
  ack: (ids: string[]) => Promise<void>
  /** Re-asks how many are waiting. */
  refresh: () => void
}

type Reply = {
  type: string
  id: number
  /** The bridge revision that answered. Absent from any bridge before 3. */
  protocol?: number
  /** The worker's stored crash-reporting setting, and what it has kept. */
  crashOn?: boolean
  crashes?: unknown[]
  captures?: unknown[]
  count?: number
  rows?: unknown
  ok?: boolean
  /** A relayed reader answer. See `readDocument`. */
  status?: number
  text?: string
  error?: string | null
}

/** What one round trip is asking for. Exactly one of these is ever set. */
type Ask = {
  take?: boolean
  ack?: string[]
  /** A board to open and read. See `scanBoard`. */
  scan?: string
  /** A request to relay to a reader on this machine. See `readDocument`. */
  read?: { url: string; method: string; headers: Record<string, string>; body?: string }
  /** A request to relay to a model provider. See `callModel`. */
  model?: { url: string; method: string; headers: Record<string, string>; body?: string }
  /** The crash-reporting choice, and a request for what the worker has kept. */
  crash?: { on?: boolean; clear?: boolean }
}

/**
 * How long a SCAN gets, which is longer than anything else here by a lot.
 *
 * The worker opens a real tab, waits for the board to finish loading, waits
 * again for its JavaScript to render the results, reads it and closes it — the
 * extension's own budget for that is 25s of loading plus 2.5s of settling. This
 * has to outlast that or the app gives up on a scan that then succeeds into a
 * void, and the page reports "no boards could be read" about a board that was
 * read.
 */
const SCAN_TIMEOUT_MS = 40000

let nextId = 1

/** One round trip, or null when nothing answers in time. */
function ask(request: Ask): Promise<Reply | null> {
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

    /*
     * A relayed request waits on somebody else's server, so it gets the scan's
     * budget rather than the probe's. This defaulted to PROBE_TIMEOUT_MS — 400ms
     * — which is right for "is the extension there" and absurd for converting a
     * PDF or waiting on a 70B model: every relayed call would have been
     * abandoned before it started and reported as "the extension did not
     * answer".
     */
    const timeout =
      request.scan !== undefined || request.read !== undefined || request.model !== undefined
        ? SCAN_TIMEOUT_MS
        : request.take === true
          ? TAKE_TIMEOUT_MS
          : PROBE_TIMEOUT_MS
    const timer = window.setTimeout(() => done(null), timeout)
    window.addEventListener('message', onMessage)
    window.postMessage(
      {
        type: REQUEST,
        id,
        take: request.take,
        ack: request.ack,
        scan: request.scan,
        // Forwarded, which they were not. The bridge picks its verb from the
        // SHAPE of what arrives, so a `read` that never crossed the wire was
        // read as a peek — the relay could not have worked at all.
        read: request.read,
        model: request.model,
        crash: request.crash,
      },
      window.location.origin,
    )
  })
}

/**
 * Reads a job board through the extension, for the scout pipeline.
 *
 * A plain function rather than a hook because of who calls it: this is handed
 * to `usePipelines` as a port and ends up inside the agent loop, where React is
 * not. It is stable by construction — module scope, no state — which is what
 * keeps the `ToolHost` memo from rebuilding on every render and restarting a
 * round mid-flight.
 *
 * It never throws and never resolves to a raw failure. Everything comes back as
 * `{ok:false, reason}` with a sentence, because the far end is a language model
 * deciding what to do next: "no extension" and "that board wants a sign-in" are
 * different problems with different answers, and a model told only that
 * something failed will retry the same board until its step cap.
 */
export async function scanBoard(
  url: string,
): Promise<{ ok: true; rows: unknown } | { ok: false; reason: string }> {
  const reply = await ask({ scan: url })

  if (reply === null) {
    return {
      ok: false,
      reason:
        'The jojo browser extension did not answer, so no board could be read. It is what lets jojo open a page you are signed into; Settings has the installer.',
    }
  }
  /*
   * An extension too old to know the verb, told apart from one that tried and
   * failed. The older bridge forwards a scan as a PEEK — it only ever looked at
   * `ack` and `take` — so it answers with a count and none of a scan's fields,
   * which is indistinguishable from a refusal unless it is named.
   *
   * Worth the four lines because an unpacked extension never auto-updates:
   * there is no channel that would ever fix this for the user, so the only way
   * they find out is a sentence that says which thing to do.
   */
  /*
   * Scanning needs revision 2. Checked by number now rather than inferred from a
   * missing `rows` field — the inference was right and could only ever say "too
   * old", where the number can also say how to fix it.
   */
  if ((reply.protocol ?? 0) < 2) return { ok: false, reason: STALE }
  if (reply.ok !== true) {
    return { ok: false, reason: reply.error ?? 'That board could not be read.' }
  }
  return { ok: true, rows: reply.rows }
}

/**
 * One request to the local reader, sent by the extension instead of the page.
 *
 * THE PROBLEM. markitdown-mcp sends no CORS headers and answers the preflight
 * with 405, so a page cannot POST to it across ports. The dev server hides that
 * by proxying `/reader/mcp` into same-origin territory; a hosted copy has no
 * proxy, and an https:// page is barred from `127.0.0.1` besides, by Chrome's
 * Local Network Access gate. Between them, the deployed app could never reach a
 * reader running on the user's own machine.
 *
 * The extension is the one part of jojo that is not a page. It fetches under
 * its own `host_permissions`, which is why board scanning already lives there —
 * this is the same move for documents, and the worker only relays to loopback.
 *
 * Returns the SAME shape as `local-service`'s `send`, so `markitdown.ts` can
 * choose a route without the protocol code above it knowing there was a choice.
 */
export async function readDocument(request: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}): Promise<
  { ok: boolean; status: number; text: string } | { failed: { reason: string } }
> {
  const reply = await ask({ read: request })

  if (reply === null) {
    return {
      failed: {
        reason:
          'The jojo browser extension did not answer, so the reader could not be reached. It is what lets this page talk to a reader on your own machine; Settings has the installer.',
      },
    }
  }

  // Named by revision rather than guessed at from a missing field. A bridge
  // that predates `read` answers a peek, which is indistinguishable from a
  // refusal unless the revision is asked for.
  if ((reply.protocol ?? 0) < NEEDS_PROTOCOL) return { failed: { reason: STALE } }

  // A transport failure carries a reason and no status; an HTTP answer carries
  // a status even when it is a bad one, and belongs to the protocol layer.
  if (reply.error != null && !reply.status) return { failed: { reason: reply.error } }

  return { ok: reply.ok === true, status: reply.status ?? 0, text: reply.text ?? '' }
}

/**
 * One request to a model provider, sent by the extension instead of the page.
 *
 * The same move as `readDocument` and for the same reason, one host further out.
 * Several providers send no CORS headers: measured against
 * `integrate.api.nvidia.com`, the preflight answers 200 carrying `vary: Origin`
 * and no `access-control-allow-origin`, so the browser refuses to let the page
 * read the reply and reports a bare "Failed to fetch" that names nothing. The
 * extension fetches under its own permissions and is not subject to that.
 *
 * The worker will only relay to loopback or to a host in its transcribed
 * provider list, so this cannot be used to read the web.
 */
export async function callModel(request: {
  url: string
  method: string
  headers: Record<string, string>
  body?: string
}): Promise<{ ok: boolean; status: number; text: string } | { failed: { reason: string } }> {
  /*
   * Asked first, and cheaply, whether there is an extension at all.
   *
   * A relayed request needs a long budget — it waits on somebody else's model —
   * but "is anything listening" needs 400ms, and conflating them cost 40 seconds
   * on every call for anyone without the extension: the relay sat waiting for a
   * bridge that was never going to answer, and only then fell back to a direct
   * request. Measured at 40.5s to a message.
   *
   * The probe is the same one the install prompt uses, so this adds a round trip
   * to a relay that was going to happen anyway and removes a 40-second stall
   * from one that was not.
   */
  if ((await ask({})) === null) {
    return {
      failed: {
        reason:
          'The jojo browser extension did not answer, so the provider could not be reached. Providers that send no CORS headers can only be called through it; Settings has the installer.',
      },
    }
  }

  const reply = await ask({ model: request })

  if (reply === null) {
    return {
      failed: {
        reason:
          'The jojo browser extension did not answer, so the provider could not be reached. Providers that send no CORS headers can only be called through it; Settings has the installer.',
      },
    }
  }

  if ((reply.protocol ?? 0) < NEEDS_PROTOCOL) return { failed: { reason: STALE } }

  if (reply.error != null && !reply.status) return { failed: { reason: reply.error } }
  return { ok: reply.ok === true, status: reply.status ?? 0, text: reply.text ?? '' }
}

/**
 * Tells the extension what the user chose, and reads back what it has kept.
 *
 * ONE CHOICE, BOTH HALVES. There is one person and they answered once, so the
 * page owns the answer and pushes it here. The worker cannot read the page's
 * storage and the page cannot read a service worker's, so without this the
 * extension would either default to reporting — which is the wrong default for
 * something nobody agreed to — or need its own switch, which is one setting
 * asked twice.
 *
 * Silently a no-op on a bridge that predates the verb: this is a preference,
 * not a request, and refusing to relay a MODEL call over a stale bridge is
 * worth a sentence where failing to sync a toggle is not. The extension's own
 * default is off, so an unreachable worker records nothing.
 */
export async function syncExtensionCrashReporting(
  on: boolean,
  clear = false,
): Promise<{ on: boolean; crashes: unknown[] } | null> {
  const reply = await ask({ crash: { on, clear } })
  if (reply === null || (reply.protocol ?? 0) < 4) return null
  return { on: reply.crashOn === true, crashes: reply.crashes ?? [] }
}

export function useCaptureInbox(): CaptureInbox {
  const [installed, setInstalled] = useState<boolean | null>(null)
  const [pending, setPending] = useState(0)
  const [version, setVersion] = useState<string | null>(null)
  /** Guards against a probe that resolves after the component has gone. */
  const alive = useRef(true)

  const [stale, setStale] = useState(false)

  const refresh = useCallback(() => {
    void ask({}).then((reply) => {
      if (!alive.current) return
      setInstalled(reply !== null)
      setPending(reply?.count ?? 0)
      // Present but behind. Read from the probe so the warning is up before
      // anything is attempted, rather than after a request has already failed.
      setStale(reply !== null && (reply.protocol ?? 0) < NEEDS_PROTOCOL)
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
    const reply = await ask({ take: true })
    const ok: { capture: CaptureEnvelope; id: string }[] = []
    const refused: { reason: CaptureRejection; id: string }[] = []

    for (const raw of reply?.captures ?? []) {
      // The id is the extension's handle, not part of the envelope the package
      // validates — carried alongside so `ack` can name exactly which ones the
      // queue may drop, whether they were filed or refused.
      const handle = (raw as { id?: unknown }).id
      const id = typeof handle === 'string' ? handle : ''
      const read = readCapture(raw)
      if (typeof read === 'string') refused.push({ reason: read, id })
      else ok.push({ capture: read, id })
    }

    return { ok, refused }
  }, [])

  const ack = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    await ask({ ack: ids })
  }, [])

  return { installed, stale, pending, version, collect, ack, refresh }
}
