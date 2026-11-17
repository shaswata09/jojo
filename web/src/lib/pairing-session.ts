/**
 * The offering device's side of a pairing, for the length of one screen.
 *
 * `core/pairing.ts` is three functions and no state. This is the state: which
 * offer is currently on screen, when it stops being good, and what to do with a
 * response when one arrives. It is deliberately the ONLY thing that holds a
 * `PairingState`, because that object contains a private key and an offer secret
 * and both should have exactly one home.
 *
 * ## Why the offer re-mints itself
 *
 * An expired code that stays on screen is a code that cannot work and does not
 * say so. The other device reads it, answers, and is refused — and the refusal
 * arrives at the far end, on the device that is not being held. So the timer
 * lives here and a new offer replaces the old one in place: what is on screen is
 * always the one that would be accepted.
 *
 * That also bounds the exposure. A jojo left open on a desk is not showing a
 * three-hour-old key; it is showing one that stops working in under three
 * minutes, and the one before it can no longer pair.
 *
 * ## What this does NOT do
 *
 * It does not open a socket, discover anything, or send. `complete` takes bytes
 * from wherever the transport got them and says whether they came from something
 * that read this screen. The transport is somebody else's problem, deliberately:
 * this file is the same on any of them.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  PAIRING_TTL_MS,
  beginPairing,
  completePairing,
  encodeOffer,
  type PairingFailure,
  type PairingState,
  type SessionKeys,
} from '@jojo/service/core/pairing'
import { pathToken, type HandoffDirection } from '@jojo/service/core/handoff'
import type { Secrets } from '@jojo/service/core/secrets'
import { SecretsUnavailable, createSecrets } from '@jojo/service/crypto/noble-secrets'
import { i18next } from '@/i18n/i18n'

export type PairingPhase =
  /** Minting the first offer. Nothing on screen yet. */
  | 'starting'
  /** An offer is on screen and good. */
  | 'offering'
  /** A response arrived and matched. Keys are held. */
  | 'paired'
  /** This device cannot pair at all — see `problem`. */
  | 'unavailable'

export type PairingSession = {
  phase: PairingPhase
  /**
   * The offer as bytes (`encodeOffer`), or null before one exists — what the
   * screen draws as a QR code for the phone to scan. A new array on every
   * re-mint, so a renderer keyed on it redraws exactly when the code changes.
   */
  offer: Uint8Array | null
  /**
   * The path every request to the other device goes to.
   *
   * Derived from the offer's secret, so it is computed here — where the secret
   * lives — and the secret itself never leaves this hook. A caller needs the
   * token to build a URL and has no business with what produced it.
   */
  token: string | null
  /**
   * Every path a phone may still be holding, newest first: the code on screen,
   * then the one it replaced while that one is still in date.
   *
   * The code on screen is swapped for a fresh one before it expires, and a
   * phone that scanned the old one just before the swap is still on its way —
   * scanning, then a person typing twelve characters. Answering only the new
   * path refused that phone ('handoff/refused') for doing nothing wrong
   * (transfer audit, 2026-11-16).
   */
  tokens: readonly string[]
  /** The agreed keys, once a device has proved it read the screen. */
  keys: SessionKeys | null
  /** Why pairing is impossible here, if it is. */
  problem: string | null
  /** Why the last response was refused, if one was. */
  refused: PairingFailure | null
  /**
   * Hands a response to the protocol. Returns the agreed keys, or null.
   *
   * Returns them rather than only setting `keys`, and that is not a
   * convenience. A caller that awaited this and then read `keys` would read the
   * value from ITS OWN render — null, because React has not re-rendered yet —
   * and conclude the pairing failed. Returning the keys is what makes the
   * result usable in the same function that asked for it.
   */
  complete: (response: Uint8Array, token?: string) => Promise<SessionKeys | null>
  /**
   * Throws the current offer away and shows a new one — and forgets a pairing.
   *
   * The screen MUST call this once the run that used the offer is over — done,
   * failed after the answer reached `complete`, or abandoned (`replacesOffer`
   * in `components/transfer-ui/send-cycle.ts`). A failure before the answer
   * keeps the offer, which the phone still holds.
   *
   * The offer is single-use and the re-mint timer stands down once paired, so
   * nothing else ever puts a code back up: after one pairing, a failed send
   * could not be retried and a second device could not be sent to without
   * leaving the page (R18).
   */
  refresh: () => void
}

/**
 * How long before expiry a fresh offer goes up.
 *
 * Not at expiry: a code replaced at the instant it dies can be read by a camera
 * a few hundred milliseconds too late, and that read fails for a reason nobody
 * watching either screen could explain. Replacing it early means the code on
 * screen always has at least this long left to live.
 */
const REFRESH_MARGIN_MS = 20_000

/**
 * Arms the re-mint of the offer, and keeps it from firing once paired.
 *
 * The timer used to run on after `complete` set the phase to 'paired', so a
 * transfer still going twenty-odd seconds before the offer's expiry had a
 * fresh offer minted under it and the phase flipped back to 'offering' — the
 * screen started asking to pair a device it was already talking to. `paired`
 * is read when the timer FIRES, not when it is armed, because pairing happens
 * in between. Returns the cancel, for the effect's cleanup.
 */
export function armRefresh(
  refresh: () => void,
  paired: () => boolean,
  delay: number = PAIRING_TTL_MS - REFRESH_MARGIN_MS,
): () => void {
  const id = setTimeout(() => {
    if (!paired()) refresh()
  }, delay)
  return () => clearTimeout(id)
}

export function usePairingSession(
  active: boolean,
  /** Which way the records go; part of the path, so a phone set the other way cannot pair. */
  direction: HandoffDirection = 'push',
): PairingSession {
  // One instance for the life of the component. `createSecrets` is cheap, but a
  // new one per render would be a new object identity in every callback below.
  const secrets = useMemo<Secrets>(() => createSecrets(), [])

  const [phase, setPhase] = useState<PairingPhase>('starting')
  const [offer, setOffer] = useState<Uint8Array | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [keys, setKeys] = useState<SessionKeys | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [refused, setRefused] = useState<PairingFailure | null>(null)
  const [generation, setGeneration] = useState(0)

  /**
   * The live offer's private half.
   *
   * A ref, not state: `complete` must see the offer that is on screen NOW, and a
   * callback closing over a state value would verify against whichever offer was
   * current when it was created — refusing a perfectly good response purely
   * because the code had refreshed since.
   */
  const state = useRef<PairingState | null>(null)
  /** The token of the offer in `state`. */
  const liveToken = useRef<string | null>(null)
  /** The offer the timer last replaced, kept answerable until it really expires. */
  const previous = useRef<{ state: PairingState; token: string } | null>(null)
  const [previousToken, setPreviousToken] = useState<string | null>(null)
  /** Set by `complete`; read by the refresh timer. A ref for the reason `state` is. */
  const paired = useRef(false)

  /** The timer's re-mint: a new code goes up, and the old one stays answerable. */
  const rollover = useCallback(() => {
    if (state.current !== null && liveToken.current !== null) {
      previous.current = { state: state.current, token: liveToken.current }
      setPreviousToken(liveToken.current)
    }
    setGeneration((n) => n + 1)
  }, [])

  // An explicit refresh is a person asking for a new code, so it starts over.
  const refresh = useCallback(() => {
    previous.current = null
    setPreviousToken(null)
    paired.current = false
    // A new code is a new session: the old keys belong to a send that has
    // ended, and keeping them left the screen saying "paired" under a code
    // nobody had scanned yet.
    setKeys(null)
    setGeneration((n) => n + 1)
  }, [])

  useEffect(() => {
    if (!active) return
    let live = true

    const mint = async () => {
      try {
        const next = await beginPairing(secrets, Date.now())
        if (!live) return
        state.current = next
        liveToken.current = null
        // The path token, derived from the offer's screen secret. It IS the
        // access control on the phone's socket: `core/handoff.ts` refuses any
        // request whose path does not carry it, which is what stops a random
        // page in another tab from reaching a phone whose address it guessed.
        // CORS headers are advice to a browser, not a gate, and are not the
        // defence — see the note on `pathToken`.
        const url = await pathToken(secrets, next.offer, direction)
        if (!live) return
        liveToken.current = url
        // 83 bytes, drawn as one QR code by the screen.
        setOffer(encodeOffer(next.offer))
        setToken(url)
        setPhase('offering')
        setProblem(null)
      } catch (cause) {
        if (!live) return
        // A device without WebCrypto or without X25519 cannot pair, and saying
        // so here — before anything is on screen — is the whole reason
        // `Secrets` throws instead of falling back to something weaker.
        state.current = null
        setOffer(null)
        setToken(null)
        setPhase('unavailable')
        setProblem(
          cause instanceof SecretsUnavailable
            ? cause.message
            : i18next.t('transfer:advice.pairingFailed'),
        )
      }
    }

    void mint()
    // Re-minting on a timer rather than watching a clock: nothing needs to know
    // the remaining time, only that a fresh code goes up before this one stops
    // working.
    const cancel = armRefresh(rollover, () => paired.current)
    return () => {
      live = false
      cancel()
    }
  }, [active, secrets, generation, rollover, direction])

  // Leaving the screen takes the private key and the agreed keys with it. There
  // is no pairing that outlives the page, by design — see `core/pairing.ts`.
  useEffect(() => {
    if (active) return
    paired.current = false
    state.current = null
    liveToken.current = null
    previous.current = null
    setPreviousToken(null)
    setOffer(null)
    setToken(null)
    setKeys(null)
    setRefused(null)
    setPhase('starting')
  }, [active])

  const complete = useCallback(
    async (response: Uint8Array, token?: string): Promise<SessionKeys | null> => {
      // The offer this phone scanned: the one whose path it answered on.
      const older = previous.current
      const current =
        token !== undefined &&
        older !== null &&
        token === older.token &&
        token !== liveToken.current
          ? older.state
          : state.current
      if (current === null) return null

      const result = await completePairing(secrets, current, response, Date.now())
      if (!result.ok) {
        setRefused(result.error)
        // An expired offer is the one failure the person can act on, and the
        // action is "show a new code", so it is taken for them.
        if (result.error === 'pairing/expired') refresh()
        return null
      }

      // Single-use. The offer that produced these keys is spent, and leaving it
      // on screen would invite a second device to pair against a session this
      // one is already holding.
      state.current = null
      liveToken.current = null
      previous.current = null
      setPreviousToken(null)
      paired.current = true
      setOffer(null)
      setRefused(null)
      setKeys(result.value)
      setPhase('paired')
      return result.value
    },
    [secrets, refresh],
  )

  const tokens = useMemo(
    () => [token, previousToken].filter((t): t is string => t !== null && t !== undefined),
    [token, previousToken],
  )

  return { phase, offer, token, tokens, keys, problem, refused, complete, refresh }
}
