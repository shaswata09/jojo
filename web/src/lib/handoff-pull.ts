/**
 * Receiving the phone's records on this computer — phone to computer.
 *
 * ## How a browser receives when it cannot be connected to
 *
 * It connects instead. A web page cannot accept a connection, which is why the
 * phone is always the side that listens; but a page that can connect to the
 * phone and POST its backup there can just as well connect and ask for the
 * phone's. So in this direction the phone serves its backup in sealed chunks
 * and this computer pulls them, one request per chunk, until the phone hands
 * over the one marked last. See `core/handoff-pull.ts` for the protocol.
 *
 * ## The order, and why nothing is asked for before the proof
 *
 * The same pairing as sending, step for step. This computer shows the
 * animation; the phone reads it, opens a socket and shows its address as a
 * typed code; this computer dials that code and asks for the phone's half of
 * the handshake; `complete` checks the phone's proof that it read the screen.
 * Only then is a single chunk asked for — and every request carries this
 * computer's own proof, so the phone hands nothing to anything else.
 *
 * ## What happens to what arrives
 *
 * Exactly what happens to a backup file opened under Settings. The bytes are
 * read by the same streaming reader (`createBackupReader`), the plan waits
 * behind the same "replace everything" confirmation, and confirming runs the
 * same `restoreBackup` with the same document store. A phone and a file must
 * not disagree about what restoring means: the disagreement would only show up
 * after somebody's records had been replaced.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
import { createBackupReader } from '@jojo/service/core/backup-stream'
import {
  describeBackup,
  replacesClause,
  type BackupRead,
  type RestorePlan,
} from '@jojo/service/core/backup'
import { decodeAddress, formatAddress, type DialAddress } from '@jojo/service/core/dial'
import { runPull, type PullFailure } from '@jojo/service/core/handoff-pull'
import type { SessionKeys } from '@jojo/service/core/pairing'
import type { Secrets } from '@jojo/service/core/secrets'
import type { Instant } from '@jojo/service/core/model'
import { bucket } from '@jojo/service/core/analytics'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import { handedOver } from '@jojo/service/repo/meta'
import { restoreBackup, type DocumentStore, type RestoreOutcome } from '@jojo/service/repo/restore'
import type { Repository } from '@jojo/service/repo/repository'
import { useKg } from '@jojo/service/react/kg-context'
import type { RestoreReport } from '@/components/settings/restore-report'
import { report } from '@/lib/analytics'
import { reportError } from '@/lib/report-error'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { markRestoredFromBackup } from '@/lib/backup'
import { DIAL_ADVICE, UNEXPECTED_ADVICE } from '@/lib/handoff-send'
import {
  HANDOFF_ADVICE,
  fetchPairingResponse,
  pullChunk,
  type HandoffFailure,
  type HandoffResult,
} from '@/lib/handoff-client'

export type PullStage =
  /** Waiting for the code from the phone. */
  | 'idle'
  /** Asking the phone for its half of the handshake. */
  | 'connecting'
  /** Chunks are arriving. */
  | 'receiving'
  /** Everything arrived and checked out; waiting for the person to agree. */
  | 'confirming'
  /** Writing what arrived over what is here. */
  | 'restoring'
  /** Restored. The outcome dialog is up and the page reloads from it. */
  | 'done'
  /** Stopped, with a reason. Nothing on this computer changed. */
  | 'failed'

/** What to say when a pull stops for a reason of its own. */
export const PULL_ADVICE: Record<Exclude<PullFailure, 'pull/cancelled'>, string> = {
  'pull/forged':
    'Part of what arrived did not come from the phone you paired with, so jojo threw all of it away. Nothing on this computer has changed — show a new code and try again.',
  'pull/oversized':
    'Your phone sent more than jojo will take in one go, so it stopped reading. Nothing on this computer has changed.',
}

/** Said when the phone's answer does not carry its proof. */
export const UNPROVEN_ADVICE =
  'That device could not prove it read the code on this screen. Show a new code and scan it again.'

/**
 * The phone's bytes as a restore plan, through the reader a backup file uses.
 *
 * Streamed in slices rather than decoded to one string, for the reason
 * `pick-backup.ts` streams a file: a backup can be more characters than V8
 * lets one string hold, and a backup that cannot be read back is not one.
 */
export function readPulled(payload: Uint8Array, slice = 1024 * 1024): BackupRead {
  const reader = createBackupReader()
  const decoder = new TextDecoder()
  for (let at = 0; at < payload.byteLength; at += slice) {
    reader.push(decoder.decode(payload.subarray(at, at + slice), { stream: true }))
  }
  reader.push(decoder.decode())
  return reader.end()
}

export type PullRun =
  | { ok: true; plan: RestorePlan }
  | { ok: false; problem: string; answered: boolean }
  /** The person walked away. There is nothing to say. */
  | null

/**
 * The whole pull, as a plain function: code in, plan or sentence out.
 *
 * Outside the hook and exported because D20 rules out mounting, and this is the
 * order a test has to be able to hold — the address before the dial, the proof
 * before any chunk, the reader before the plan. `answered` says whether the
 * phone's answer reached `complete`, which is the line between a failure the
 * same code can retry and one that spends it (`send-cycle.ts`).
 */
export async function pullFromPhone({
  code,
  token,
  secrets,
  complete,
  fetchPairing = fetchPairingResponse,
  fetchChunk = pullChunk,
  onStage,
  onTarget,
  onBytes,
  cancelled = () => false,
  signal,
}: {
  code: string
  /** The code on screen, or every path the phone may hold, newest first (`PairingSession.tokens`). */
  token: string | readonly string[]
  secrets: Secrets
  complete: (response: Uint8Array, token?: string) => Promise<SessionKeys | null>
  fetchPairing?: (
    address: DialAddress,
    token: string,
    signal?: AbortSignal,
  ) => Promise<HandoffResult<Uint8Array>>
  fetchChunk?: (
    address: DialAddress,
    token: string,
    request: Uint8Array,
    signal?: AbortSignal,
  ) => Promise<HandoffResult<Uint8Array>>
  /** Aborts the request in flight when the person cancels. */
  signal?: AbortSignal
  onStage?: (stage: PullStage) => void
  onTarget?: (target: string) => void
  onBytes?: (bytes: number) => void
  cancelled?: () => boolean
}): Promise<PullRun> {
  const read = decodeAddress(code)
  if (!read.ok) return { ok: false, problem: DIAL_ADVICE[read.error], answered: false }
  const address = read.value
  onTarget?.(formatAddress(address))

  onStage?.('connecting')
  // The code on screen first, then the one it replaced — see `PairingSession.tokens`.
  const tokens = typeof token === 'string' ? [token] : token
  let path = tokens[0] ?? ''
  let response = await fetchPairing(address, path, signal)
  for (const older of tokens.slice(1)) {
    if (response.ok || response.error !== 'handoff/refused') break
    path = older
    response = await fetchPairing(address, path, signal)
  }
  if (!response.ok) {
    if (response.error === 'handoff/cancelled' || cancelled()) return null
    return { ok: false, problem: HANDOFF_ADVICE[response.error], answered: false }
  }

  // The proof. Nothing below runs for a phone that did not read this screen.
  const keys = await complete(response.value, path)
  if (keys === null) return { ok: false, problem: UNPROVEN_ADVICE, answered: true }
  if (cancelled()) return null

  onStage?.('receiving')
  const pulled = await runPull<HandoffFailure>({
    secrets,
    keys,
    fetchChunk: (request) => fetchChunk(address, path, request, signal),
    onBytes,
    cancelled,
  })
  if (!pulled.ok) {
    if (pulled.error === 'pull/cancelled' || pulled.error === 'handoff/cancelled' || cancelled())
      return null
    const problem =
      pulled.error === 'pull/forged' || pulled.error === 'pull/oversized'
        ? PULL_ADVICE[pulled.error]
        : HANDOFF_ADVICE[pulled.error]
    return { ok: false, problem, answered: true }
  }
  // Walked away while the last chunk was in flight: nothing to ask about.
  if (cancelled()) return null

  const plan = readPulled(pulled.payload)
  if (!plan.ok) {
    return {
      ok: false,
      problem: `What your phone sent cannot be restored: ${plan.error.message}. Nothing on this computer has changed.`,
      answered: true,
    }
  }
  return { ok: true, plan: plan.value }
}

/**
 * The confirmation, worded as the backup-file one is.
 *
 * `DataPanel` asks "Replace everything with this backup?" and names what the
 * file holds, what goes, that it cannot be undone, and that a backup first is
 * the way to keep what is here. This says the same four things in the same
 * order; only the source is named differently, because a person who has just
 * pointed a phone at the screen did not choose a file.
 */
export function pullConfirmCopy(plan: RestorePlan): {
  title: string
  description: string
  confirm: string
} {
  return {
    title: 'Replace everything with what your phone sent?',
    description: `Your phone sent ${describeBackup(plan)}. ${replacesClause(plan, 'you have now')}, and it cannot be undone — the history goes with them. Download a backup first if you are not sure.`,
    confirm: 'Replace everything',
  }
}

/**
 * Writes a plan the person agreed to, the way a backup file is written.
 *
 * `restoreBackup` is the one restore — the same call `DataPanel` makes for a
 * file, with the same document store. What is added is the handover stamp,
 * and only on success: this WAS a handover from another device, which a file
 * restore is not, and it is what lets this page say how far the two devices
 * have drifted since. The phone stamps its own when it hands the last chunk
 * over. `restore-received.ts` does the same on the phone, for the same reason.
 */
export async function restoreFromPhone(
  repo: Repository,
  blobs: DocumentStore,
  plan: RestorePlan,
  at: string,
): Promise<RestoreOutcome> {
  const outcome = await restoreBackup(repo, blobs, plan, at)
  if (!outcome.ok) return outcome
  repo.setMeta(handedOver(repo.meta, at as Instant))
  // As Settings does after a file restore: what just arrived is a copy of the
  // phone's store, so the backup prompt must not greet the reloaded page by
  // asking for a backup of records that already exist somewhere else.
  markRestoredFromBackup(at)
  return outcome
}

/**
 * One answer to the confirmation, whichever arrives first.
 *
 * `ConfirmDialog`'s confirm button calls `onConfirm()` and THEN
 * `onOpenChange(false)`, and the panel maps a close to "decline". Without this,
 * agreeing ran the restore and then the decline on top of it: the screen said
 * "Nothing was changed" while every record was being replaced underneath. The
 * phone's panel had exactly this bug (`mobile/src/lib/receive-decision.ts`).
 * First answer wins; the second is ignored.
 */
export function createDecision(): { take: () => boolean } {
  let taken = false
  return {
    take: () => {
      if (taken) return false
      taken = true
      return true
    },
  }
}

export type PullState = {
  stage: PullStage
  /** Payload bytes so far. The phone does not say the total up front. */
  bytes: number
  target: string | null
  problem: string | null
  /** The checked plan waiting for the person, while `confirming`. */
  plan: RestorePlan | null
  /** What the restore did, for the dialog that ends in a reload. */
  outcome: RestoreReport | null
  start: (code: string, tokens: readonly string[]) => Promise<void>
  /** Agrees to the plan. Destroys what is here. */
  confirm: () => Promise<void>
  /** Declines the plan. Nothing changes. */
  decline: () => void
  cancel: () => void
}

export function useHandoffPull({
  complete,
}: {
  complete: (response: Uint8Array, token?: string) => Promise<SessionKeys | null>
}): PullState {
  const { repo } = useKg()
  const blobs = useVaultBlobs()
  const secrets = useMemo(() => createSecrets(), [])
  const [stage, setStage] = useState<PullStage>('idle')
  const [bytes, setBytes] = useState(0)
  const [target, setTarget] = useState<string | null>(null)
  const [problem, setProblem] = useState<string | null>(null)
  const [plan, setPlan] = useState<RestorePlan | null>(null)
  const [outcome, setOutcome] = useState<RestoreReport | null>(null)
  /** The current run's cancel — one per run, so a stale run cannot write over a new one. See `handoff-send.ts`. */
  const run = useRef<AbortController | null>(null)
  /** The answer to the current plan. A ref: both handlers fire in one event. */
  const decision = useRef(createDecision())

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
      setProblem(null)
      setBytes(0)
      setPlan(null)
      try {
        const pulled = await pullFromPhone({
          code,
          token: tokens,
          signal: mine.signal,
          secrets,
          // The page's own `complete`, which also records that the answer was
          // handed over — the line `send-cycle.ts` draws for both directions.
          complete,
          onStage: setStage,
          onTarget: setTarget,
          onBytes: setBytes,
          cancelled: () => cancelled.current,
        })
        if (pulled === null || cancelled.current) return
        if (!pulled.ok) {
          setProblem(pulled.problem)
          setStage('failed')
          return
        }
        decision.current = createDecision()
        setPlan(pulled.plan)
        setStage('confirming')
      } catch (thrown) {
        if (cancelled.current) return
        reportError('transfer', thrown)
        setProblem(UNEXPECTED_ADVICE)
        setStage('failed')
      }
    },
    [complete, secrets],
  )

  const confirm = useCallback(async () => {
    const staged = plan
    if (staged === null || !decision.current.take()) return
    setPlan(null)
    setStage('restoring')
    const done = await restoreFromPhone(repo, blobs, staged, new Date().toISOString())
    if (!done.ok) {
      setProblem(done.message)
      setStage('failed')
      return
    }
    // Counted here because, in this direction, the phone is the sender and
    // reports nothing — one transfer is still one event.
    report('transfer_completed', { records: bucket(done.nodes) })
    setOutcome({
      held: staged.nodes.length,
      nodes: done.nodes,
      documents: done.documents,
      skipped: done.skipped,
    })
    setStage('done')
  }, [plan, repo, blobs])

  const decline = useCallback(() => {
    if (!decision.current.take()) return
    setPlan(null)
    setProblem('Nothing was changed. What your phone sent has been thrown away.')
    setStage('failed')
  }, [])

  const cancel = useCallback(() => {
    run.current?.abort()
    run.current = null
    setPlan(null)
    setStage('idle')
    setBytes(0)
  }, [])

  return {
    stage,
    bytes,
    target,
    problem,
    plan,
    outcome,
    start,
    confirm,
    decline,
    cancel,
  }
}
