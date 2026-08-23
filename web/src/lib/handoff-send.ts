/**
 * Sending the backup to a phone that is already paired and already listening.
 *
 * The last mile, and the only part of the transfer a person has to steer. By the
 * time this runs the phone has read the code and agreed a key; what it cannot do
 * is tell this browser where it is. There is no API for discovering a device on
 * the local network from a web page, so the address arrives the only way it can:
 * twelve characters, read off one screen and typed into another.
 *
 * ## The order, and why the backup is built last
 *
 * Address, then pairing response, then backup, then chunks. Building the backup
 * first would feel faster and would mean holding several megabytes in memory
 * while waiting to discover the phone is unreachable, the code was mistyped, or
 * this browser is Safari. Every cheap refusal happens before the expensive step.
 *
 * ## What is sent, and what is not
 *
 * Sealed convoy chunks and nothing else. The pairing response comes back in the
 * clear because it is useless to anything that did not read the screen. No
 * cookies, no credentials, no identifiers — see `handoff-client.ts`.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { planConvoy } from '@jojo/service/core/convoy'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import { decodeAddress, formatAddress, type DialFailure } from '@jojo/service/core/dial'
import type { SessionKeys } from '@jojo/service/core/pairing'
import {
  HANDOFF_ADVICE,
  fetchPairingResponse,
  sendChunk,
  type HandoffFailure,
} from '@/lib/handoff-client'

export type SendStage =
  /** Waiting for the address from the other device. */
  | 'idle'
  /** Asking the phone for its pairing response. */
  | 'connecting'
  /** Gathering the records and documents. */
  | 'packing'
  /** Chunks are moving. */
  | 'sending'
  /** Every chunk was accepted. */
  | 'done'
  /** Stopped, with a reason. */
  | 'failed'

export type SendState = {
  stage: SendStage
  /** 0 to 1 while sending. */
  progress: number
  /** Where it is going, once the address has been read. */
  target: string | null
  /** What went wrong, in words a person can act on. */
  problem: string | null
  /** Reads the typed code and runs the whole thing. */
  start: (code: string, token: string) => Promise<void>
  cancel: () => void
}

/** What to say when the twelve characters do not parse. */
const DIAL_ADVICE: Record<DialFailure, string> = {
  'dial/unreadable': 'That code has characters jojo does not use. Check it against the other screen.',
  'dial/length': 'That code is the wrong length. It is twelve characters, in three groups of four.',
  'dial/mistyped': 'That code does not check out — a character is wrong somewhere. Try typing it again.',
}

export function useHandoffSend({
  complete,
  build,
}: {
  /** Hands the pairing response to the protocol; returns the agreed keys. */
  complete: (response: Uint8Array) => Promise<SessionKeys | null>
  /** Produces the backup bytes. Called late, and only once. */
  build: () => Promise<Uint8Array>
}): SendState {
  // One instance for the life of the hook. Stateless and cheap, but a new
  // object identity on every render would churn the callbacks below.
  const secrets = useMemo(() => createSecrets(), [])
  const [stage, setStage] = useState<SendStage>('idle')
  const [progress, setProgress] = useState(0)
  const [target, setTarget] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)

  /**
   * Set when the person walks away from a running transfer.
   *
   * A ref, because the send loop closes over it and must see the CURRENT value
   * rather than the one that existed when it started — a cancel that a running
   * loop cannot observe is not a cancel.
   */
  const cancelled = useRef(false)

  const stop = useCallback((failure: HandoffFailure) => {
    setProblem(HANDOFF_ADVICE[failure])
    setStage('failed')
  }, [])

  const start = useCallback(
    async (code: string, token: string) => {
      cancelled.current = false
      setProblem(null)
      setProgress(0)

      const read = decodeAddress(code)
      if (!read.ok) {
        setProblem(DIAL_ADVICE[read.error])
        setStage('failed')
        return
      }
      const address = read.value
      setTarget(formatAddress(address))

      setStage('connecting')
      const response = await fetchPairingResponse(address, token)
      if (!response.ok) return stop(response.error)

      const keys = await complete(response.value)
      if (keys === null) {
        // The device answered and could not prove it read this screen. That is
        // either a stale code or something in the middle of the network, and
        // jojo cannot tell which — so it says the part it is sure of.
        setProblem(
          'That device could not prove it read the code on this screen. Show a new code and scan it again.',
        )
        setStage('failed')
        return
      }
      if (cancelled.current) return

      setStage('packing')
      const payload = await build()
      if (cancelled.current) return

      setStage('sending')
      // The key is chosen by DIRECTION: this device is the offerer, so it seals
      // with the offerer-to-answerer key. Using one key both ways would put two
      // counters in one nonce space, which is how GCM nonce reuse happens.
      const plan = planConvoy(secrets, keys.offererToAnswerer, payload)

      for (let seq = 0; seq < plan.chunks; seq += 1) {
        if (cancelled.current) return
        const sent = await sendChunk(address, token, await plan.seal(seq))
        if (!sent.ok) return stop(sent.error)
        // Reported after the phone acknowledged, not after the write. A bar that
        // runs ahead of what actually arrived is a bar that finishes and then
        // waits, which reads as a freeze at 100%.
        setProgress((seq + 1) / plan.chunks)
      }

      setStage('done')
    },
    [build, complete, secrets, stop],
  )

  const cancel = useCallback(() => {
    cancelled.current = true
    setStage('idle')
    setProgress(0)
  }, [])

  return { stage, progress, target, problem, start, cancel }
}
