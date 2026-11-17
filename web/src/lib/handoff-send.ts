/**
 * Sending the backup to a phone that is already paired and already listening.
 * The other direction — this computer pulling the phone's backup — is
 * `handoff-pull.ts`, over the same pairing and the same socket.
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
import { handedOver } from '@jojo/service/repo/meta'
import { useKg } from '@jojo/service/react/kg-context'
import type { Instant } from '@jojo/service/core/model'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import { decodeAddress, formatAddress, type DialFailure } from '@jojo/service/core/dial'
import type { SessionKeys } from '@jojo/service/core/pairing'
import { report } from '@/lib/analytics'
import { reportError } from '@/lib/report-error'
import { bucket } from '@jojo/service/core/analytics'
import type { HandoffOutcome } from '@jojo/service/core/handoff'
import { i18next } from '@/i18n/i18n'
import {
  fetchOutcome,
  handoffAdvice,
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

/**
 * What the phone's person did with what was sent, once `stage` is 'done'.
 *
 * `waiting` while the phone shows its confirmation; `unknown` when the phone
 * stopped answering, or is a build that cannot say.
 */
export type SendOutcome = Exclude<HandoffOutcome, 'pending'> | 'waiting' | 'unknown'

export type SendState = {
  stage: SendStage
  /** Set once every chunk is in — see `SendOutcome`. */
  outcome: SendOutcome | null
  /** 0 to 1 while sending. */
  progress: number
  /** Where it is going, once the address has been read. */
  target: string | null
  /** What went wrong, in words a person can act on. */
  problem: string | null
  /**
   * Reads the typed code and runs the whole thing. `tokens` is every path the
   * phone may hold, newest first — see `PairingSession.tokens`.
   */
  start: (code: string, tokens: readonly string[]) => Promise<void>
  cancel: () => void
}

/** Where each parse failure's sentence sits in the catalog, under `advice.dial`. */
const DIAL_ADVICE_KEY: Record<DialFailure, string> = {
  'dial/unreadable': 'unreadable',
  'dial/length': 'length',
  'dial/mistyped': 'mistyped',
}

/** What to say when the twelve characters do not parse. */
export const dialAdvice = (failure: DialFailure): string =>
  i18next.t(`transfer:advice.dial.${DIAL_ADVICE_KEY[failure]}`)

/**
 * What to say when a step THROWS instead of returning a failure.
 *
 * Every failure the run below knows about arrives as `{ ok: false }` and has a
 * sentence waiting for it. A REJECTION had none. `build()` reads every document
 * out of IndexedDB and stringifies the lot — `backup.ts` names the three ways
 * that throws — and `complete()` runs the handshake crypto, so either can
 * reject; the only caller does `void send.start(...)` with no `.catch`. So the
 * stage stayed on 'packing', the panel kept spinning with its field disabled,
 * and the only way out of it was reloading the page.
 *
 * The second sentence is a promise this can keep: `core/convoy.ts` completes
 * only on a chunk flagged final, and the phone acts on nothing before that —
 * see `receive-landing.ts`. A transfer that stops halfway leaves it untouched.
 */
export const unexpectedAdvice = (): string => i18next.t('transfer:advice.unexpected')

/**
 * Runs the transfer and answers with the sentence to show, or null if it got
 * all the way through.
 *
 * A plain function outside the hook, and exported, because D20 rules out
 * mounting: this is the half a test can reach, and a guard nothing exercises is
 * a guard nobody notices the loss of.
 */
export async function guardedTransfer(run: () => Promise<void>): Promise<string | null> {
  try {
    await run()
    return null
  } catch (thrown) {
    // To the console and the local crash log as well as to the screen. The
    // sentence above cannot name a quota wall or a document that would not
    // read, and somebody debugging their own machine needs the one it was.
    reportError('transfer', thrown)
    return unexpectedAdvice()
  }
}

/** How often a finished send asks the phone what its person decided. */
export const OUTCOME_POLL_MS = 2_000
/** How long it keeps asking — the person may read the confirmation slowly. */
export const OUTCOME_WAIT_MS = 10 * 60_000

/**
 * Asks, until the phone's person has answered — or the phone stops answering.
 *
 * Exported, and the clock injected, because D20 rules out mounting: the rule
 * worth testing is that only a real answer ends the wait with one, and that a
 * phone which cannot say (an older build refuses the path) is `unknown` at
 * once rather than after ten minutes.
 */
export async function awaitOutcome({
  ask,
  sleep,
  now,
  cancelled,
  intervalMs = OUTCOME_POLL_MS,
  limitMs = OUTCOME_WAIT_MS,
}: {
  ask: () => Promise<{ ok: true; value: HandoffOutcome } | { ok: false; error: HandoffFailure }>
  sleep: (ms: number) => Promise<void>
  now: () => number
  cancelled: () => boolean
  intervalMs?: number
  limitMs?: number
}): Promise<Exclude<SendOutcome, 'waiting'> | null> {
  const started = now()
  let misses = 0
  for (;;) {
    if (cancelled()) return null
    const got = await ask()
    if (cancelled()) return null
    if (got.ok) {
      if (got.value !== 'pending') return got.value
      misses = 0
    } else {
      // A phone that refuses the path cannot say; one that has gone quiet
      // for several asks in a row has closed its socket.
      if (got.error === 'handoff/refused') return 'unknown'
      misses += 1
      if (misses >= 5) return 'unknown'
    }
    if (now() - started >= limitMs) return 'unknown'
    await sleep(intervalMs)
  }
}

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const id = setTimeout(resolve, ms)
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        resolve()
      },
      { once: true },
    )
  })

export function useHandoffSend({
  complete,
  build,
}: {
  /** Hands the pairing response to the protocol; returns the agreed keys. */
  complete: (response: Uint8Array, token?: string) => Promise<SessionKeys | null>
  /** Produces the backup bytes. Called late, and only once. */
  build: () => Promise<Uint8Array>
}): SendState {
  const { repo } = useKg()
  // One instance for the life of the hook. Stateless and cheap, but a new
  // object identity on every render would churn the callbacks below.
  const secrets = useMemo(() => createSecrets(), [])
  const [stage, setStage] = useState<SendStage>('idle')
  const [outcome, setOutcome] = useState<SendOutcome | null>(null)
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
  /**
   * The run that is current, with its own cancel.
   *
   * One shared boolean used to serve every run: starting again reset it, so a
   * run cancelled a moment earlier woke up, found it false, and wrote its
   * stage over the new run's (transfer audit, 2026-11-16). Each run now checks
   * that it is still the current one, and its controller aborts the request
   * in flight rather than waiting for it.
   */
  const run = useRef<AbortController | null>(null)

  const start = useCallback(
    async (code: string, tokens: readonly string[]) => {
      run.current?.abort()
      const mine = new AbortController()
      run.current = mine
      const cancelled = {
        get current() {
          return mine.signal.aborted || run.current !== mine
        },
      }
      const stop = (failure: HandoffFailure) => {
        if (cancelled.current || failure === 'handoff/cancelled') return
        setProblem(handoffAdvice(failure))
        setStage('failed')
      }
      setProblem(null)
      setProgress(0)
      setOutcome(null)

      // Every await below is inside the guard, not just the two that are known
      // to throw: a step that stops the run without a word on screen is the
      // failure being fixed here, and which step it was is not the point.
      const advice = await guardedTransfer(async () => {
        const read = decodeAddress(code)
        if (!read.ok) {
          setProblem(dialAdvice(read.error))
          setStage('failed')
          return
        }
        const address = read.value
        setTarget(formatAddress(address))

        setStage('connecting')
        // The code on screen first, then the one it replaced — a phone that
        // scanned just before the swap answers on the older path.
        let token = tokens[0] ?? ''
        let response = await fetchPairingResponse(address, token, mine.signal)
        for (const older of tokens.slice(1)) {
          if (response.ok || response.error !== 'handoff/refused') break
          token = older
          response = await fetchPairingResponse(address, token, mine.signal)
        }
        if (!response.ok) return stop(response.error)

        const keys = await complete(response.value, token)
        if (cancelled.current) return
        if (keys === null) {
          // The device answered and could not prove it read this screen. That is
          // either a stale code or something in the middle of the network, and
          // jojo cannot tell which — so it says the part it is sure of.
          setProblem(i18next.t('transfer:advice.unproven'))
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
          const sent = await sendChunk(address, token, await plan.seal(seq), mine.signal)
          if (!sent.ok) return stop(sent.error)
          // Reported after the phone acknowledged, not after the write. A bar that
          // runs ahead of what actually arrived is a bar that finishes and then
          // waits, which reads as a freeze at 100%.
          setProgress((seq + 1) / plan.chunks)
        }

        setStage('done')
        setOutcome('waiting')

        // The bytes are there; the records are not yet. The phone asks its
        // person before it replaces anything, so this asks the phone what they
        // decided.
        const answer = await awaitOutcome({
          ask: () => fetchOutcome(address, token, secrets, keys, mine.signal),
          sleep: (ms) => sleepFor(ms, mine.signal),
          now: Date.now,
          cancelled: () => cancelled.current,
        })
        if (answer === null || cancelled.current) return
        setOutcome(answer)
        if (answer !== 'applied') return

        /*
         * Recorded on this device, not sent with the bytes — and only once the
         * phone's person took them. `handoverAt` is a fact about THIS store:
         * when it last agreed with another one. Stamped at the last chunk, a
         * transfer declined on the phone left this page saying the phone held
         * the same records.
         */
        repo.setMeta(handedOver(repo.meta, new Date().toISOString() as Instant))
        /*
         * Only from the SENDER, and only once the records have landed. The
         * receiving device reports nothing — one transfer is one event, and
         * counting both ends would double every figure.
         */
        report('transfer_completed', { records: bucket(repo.getSnapshot().nodes().length) })
      })
      if (advice === null || cancelled.current) return
      setProblem(advice)
      setStage('failed')
    },
    [build, complete, secrets, repo],
  )

  const cancel = useCallback(() => {
    run.current?.abort()
    run.current = null
    setStage('idle')
    setOutcome(null)
    setProgress(0)
  }, [])

  return { stage, outcome, progress, target, problem, start, cancel }
}
