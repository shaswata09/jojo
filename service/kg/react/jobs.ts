/**
 * L4 — the background work that is still going, wherever the person went.
 *
 * THE DEFECT THIS EXISTS TO FIX, in the words it was reported in: "if I click
 * tailor material and then while the agent is writing the snippet I go to other
 * tabs, this job gets cancelled". It did: the panel started the work, held the
 * `AbortController`, and aborted it from an unmount cleanup — so a minute of a
 * local model's time was thrown away by a click on a tab, and nothing was saved
 * because the write is the last thing a run does.
 *
 * `agent-runs.ts` has already made this argument for conversations, and this is
 * the same registry for everything else: work belongs to the app rather than to
 * the component that asked for it, so it lives above the router and the screen
 * becomes a view of it. What is different is that this one is a QUEUE — the
 * reasoning is in `core/jobs.ts`, and so is every rule about what may start.
 *
 * THE SHAPE is `repo/queue.ts`'s, for the reason `agent-runs.ts` gives: a
 * factory closure, locals rather than fields, a `Set` of listeners, and getters
 * returning values stable between notifications so `useSyncExternalStore` can
 * compare them.
 *
 * WHAT IS DELIBERATELY NOT HERE. No clock, no cancellation of its own, no
 * toast: `now` and `newSignal` are handed in by the app — `kg/react` may not
 * name `AbortSignal`, and D26 keeps the clock out of `kg` — and what to say
 * when something finishes is a question each platform's toast port answers
 * differently. This file starts things, stops things, and tells listeners.
 */

import { kgError } from '../log'
import { about as aboutIn, enqueue, forget, isLive, live, mark, nextToStart } from '../core/jobs'
import type { Job, JobState } from '../core/jobs'
import type { Instant } from '../core/model'
import type { Cancellation } from '../agent/loop'

/** What a job's own work is handed. */
export type JobControl<S extends Cancellation> = {
  /** Stopped when a person cancels, or when the store is torn down. */
  readonly signal: S
  /** Says what it is doing now. Shown on the card that asked for it. */
  readonly onStep: (step: string) => void
}

export type JobOutcome =
  /** `notes` are doubts about a result that was still produced. See `Job.notes`. */
  | { ok: true; notes?: readonly string[] }
  /** `reason` is shown to the person, so it is written for them. */
  | { ok: false; reason: string }

export type JobSpec<S extends Cancellation> = {
  /** See `Job.id` — what makes asking twice harmless. */
  readonly id: string
  readonly kind: string
  readonly label: string
  readonly about: string
  /** See `Job.notify`. Off by default: the app's own work stays quiet. */
  readonly notify?: boolean
  readonly run: (control: JobControl<S>) => Promise<JobOutcome>
}

/** Told once per job that settles, wherever the person is. The toast's cue. */
export type JobSettled = (job: Job) => void

export type Jobs = {
  /** Queue it, or leave the one already going. Returns the job's id. */
  start: <S extends Cancellation>(spec: JobSpec<S>) => string
  /** Stop one. A queued job never starts; a running one is aborted. */
  cancel: (id: string) => void
  /** Forget a settled job. A live one is left alone — cancel it first. */
  forget: (id: string) => void
  get: (id: string) => Job | undefined
  /** Every job for one record, oldest first. What a panel renders. */
  about: (recordId: string) => readonly Job[]
  /** Everything queued or running, so a shell can say the app is busy. */
  live: () => readonly Job[]
  all: () => readonly Job[]
  subscribe: (listener: () => void) => () => void
  /** Stops everything. For a store being torn down or replaced. */
  stopAll: () => void
}

export type JobsOptions<S extends Cancellation> = {
  /** A fresh cancellation, from the platform. See `use-fit.ts` on why injected. */
  newSignal: () => { signal: S; abort: () => void }
  now: () => Instant
  /** How many may run at once. One, unless the model is somebody else's. */
  limit?: number
  onSettled?: JobSettled
  onError?: (thrown: unknown) => void
}

export function createJobs<S extends Cancellation>({
  newSignal,
  now,
  limit,
  onSettled,
  onError,
}: JobsOptions<S>): Jobs {
  let jobs: readonly Job[] = []
  /**
   * What each live job needs to be stopped, and what to run when its turn comes.
   *
   * The ENTRY OBJECT is also the run's identity. A job's id is reused on purpose
   * — that is what makes asking twice harmless and what makes Re-run the same
   * card rather than a second one — so "the job at this id" and "the run that
   * just resolved" are not the same thing, and only an identity the id cannot
   * collide with can tell them apart. See `settle`.
   */
  type Pending = {
    run: (control: JobControl<S>) => Promise<JobOutcome>
    stop?: () => void
  }
  const pending = new Map<string, Pending>()
  const listeners = new Set<() => void>()

  /** True while `stopAll` is draining. Read by `pump`. */
  let stopping = false

  let liveSnapshot: readonly Job[] = []
  const aboutSnapshots = new Map<string, readonly Job[]>()

  const same = <T>(a: readonly T[], b: readonly T[]): boolean =>
    a.length === b.length && a.every((x, i) => x === b[i])

  function notify(): void {
    /*
     * Recomputed once here rather than per subscriber, and kept when nothing in
     * them moved — `useSyncExternalStore` compares what the getter returns and
     * loops forever on a fresh array. A job object is replaced wholesale by
     * `mark`, so identity comparison is exact rather than approximate.
     */
    const nextLive = live(jobs)
    if (!same(nextLive, liveSnapshot)) liveSnapshot = nextLive
    for (const [recordId, held] of aboutSnapshots) {
      const next = aboutIn(jobs, recordId)
      if (!same(next, held)) aboutSnapshots.set(recordId, next)
    }
    // Copied before iterating: a listener that unsubscribes itself while being
    // notified would otherwise mutate the set mid-loop.
    // eslint-disable-next-line unicorn/no-useless-spread
    for (const listener of [...listeners]) listener()
  }

  const set = (next: readonly Job[]): void => {
    jobs = next
    notify()
  }

  /**
   * Record how a job ended. The ONE place that decides it.
   *
   * `from` is the pending entry of the run REPORTING the outcome, and is
   * omitted when a person is the one deciding — `cancel` and `stopAll` mean
   * whatever is live right now, whichever run that is.
   *
   * Two races meet here, and they need different answers.
   *
   * The first is ordinary: a person presses Cancel, the fetch unwinds a moment
   * later, and the run resolves with whatever it had. `isLive` settles that —
   * the first answer stands, so a job somebody stopped never announces itself
   * as finished.
   *
   * The second is what `isLive` alone got WRONG, because it asks about the id
   * rather than the run. Cancel a tailored CV and press Re-run: the replacement
   * is live at the same id, so the abandoned fetch's late outcome passed the
   * `isLive` test and settled the REPLACEMENT — marking a run that was still
   * going "failed", with the reason belonging to the run the person threw away.
   * The card then read "did not finish" and the toast said so out loud, while
   * the work it described ran on and saved. Comparing the entry identity is
   * what makes the answer about the run instead of about the name.
   */
  const settle = (
    id: string,
    state: JobState,
    error?: string,
    from?: Pending,
    notes?: readonly string[],
  ): void => {
    const job = jobs.find((j) => j.id === id)
    if (job === undefined || !isLive(job)) return
    if (from !== undefined && pending.get(id) !== from) return
    pending.delete(id)
    set(
      mark(
        jobs,
        id,
        {
          state,
          endedAt: now(),
          ...(error === undefined ? {} : { error }),
          // D21: a key is added or it is absent; `{ notes: undefined }` is not
          // assignable and would survive as a present key anyway.
          ...(notes === undefined || notes.length === 0 ? {} : { notes }),
        },
        // The step goes with it: a card that kept "Writing the tailored
        // version" under a finished job would be describing the past.
        ['step'],
      ),
    )
    const settled = jobs.find((j) => j.id === id)
    if (settled !== undefined) onSettled?.(settled)
    pump()
  }

  /**
   * Start whatever may start, then stop asking.
   *
   * Called after every transition rather than on a timer: the only things that
   * free a slot are a job settling and a job being cancelled, and both come
   * through here. A loop rather than one start, because cancelling three
   * queued jobs at once frees three slots.
   */
  function pump(): void {
    // Nothing may start while the store is going away. Without this, `stopAll`
    // cancelling the running job frees a slot, and the next QUEUED job is
    // started — its `run` invoked, its model request actually sent — a line
    // before the same loop aborts it.
    if (stopping) return
    for (;;) {
      const next = nextToStart(jobs, limit)
      if (next === undefined) return
      const entry = pending.get(next.id)
      if (entry === undefined) {
        // Queued with nothing to run: impossible through `start`, and survivable
        // rather than fatal if it ever happens.
        set(mark(jobs, next.id, { state: 'failed', error: 'Nothing to run.', endedAt: now() }))
        continue
      }

      const stop = newSignal()
      // A fresh entry per RUN rather than a patch of the old one: this object is
      // the identity `settle` compares against. See `Pending`.
      const mine: Pending = { run: entry.run, stop: stop.abort }
      pending.set(next.id, mine)
      const id = next.id
      set(mark(jobs, id, { state: 'running', startedAt: now() }))

      void mine
        .run({
          signal: stop.signal,
          onStep: (step) => {
            // A step reported after this run is over is a straggler — from an
            // abort, or from a run a Re-run has already replaced at the same
            // id. It must neither put a finished card back to work nor label
            // the run that replaced it.
            if (pending.get(id) !== mine) return
            const held = jobs.find((j) => j.id === id)
            if (held !== undefined && held.state === 'running') set(mark(jobs, id, { step }))
          },
        })
        .then((outcome) => {
          /*
           * Still no check for the signal here, and still deliberate: a
           * cancelled job was settled by `cancel` or `stopAll` the moment the
           * person asked, and a second reading of "stopped" in this branch
           * would be a second place to be wrong about it. What this DOES pass
           * is `mine`, so the outcome lands on the run that produced it and
           * never on whatever happens to hold the id by the time it arrives.
           */
          if (outcome.ok) settle(id, 'done', undefined, mine, outcome.notes)
          else settle(id, 'failed', outcome.reason, mine)
        })
        .catch((thrown: unknown) => {
          /*
           * Every layer under this reports failure as a value, so reaching here
           * means something threw that none of them expected. Without the catch
           * it is an unhandled rejection and a job that says "running" forever.
           */
          onError?.(thrown)
          kgError('job threw', thrown)
          settle(
            id,
            'failed',
            thrown instanceof Error ? thrown.message : 'That did not finish.',
            mine,
          )
        })
    }
  }

  return {
    start<T extends Cancellation>(spec: JobSpec<T>): string {
      const existing = jobs.find((j) => j.id === spec.id)
      if (existing !== undefined && isLive(existing)) return spec.id
      /*
       * The cast is the gap between one job's signal type and the registry's.
       * Nothing is being reinterpreted: every job in a given app is handed the
       * signal that app's `newSignal` makes, and `Cancellation` is all this
       * file ever reads off it.
       */
      pending.set(spec.id, {
        run: spec.run as unknown as (control: JobControl<S>) => Promise<JobOutcome>,
      })
      set(
        enqueue(jobs, {
          id: spec.id,
          kind: spec.kind,
          label: spec.label,
          about: spec.about,
          ...(spec.notify === true ? { notify: true } : {}),
          state: 'queued',
          queuedAt: now(),
        }),
      )
      pump()
      return spec.id
    },

    cancel(id: string): void {
      const job = jobs.find((j) => j.id === id)
      if (job === undefined || !isLive(job)) return
      const entry = pending.get(id)
      // Aborting a running job is what the signal is for; the run then resolves
      // or rejects on its own and `settle` records what a person decided.
      entry?.stop?.()
      settle(id, 'cancelled')
    },

    forget(id: string): void {
      const next = forget(jobs, id)
      if (next !== jobs) set(next)
    },

    get: (id) => jobs.find((j) => j.id === id),

    about(recordId: string): readonly Job[] {
      // Memoised per record, because this is a `useSyncExternalStore` getter and
      // a new array every call is an infinite render loop.
      const held = aboutSnapshots.get(recordId)
      if (held !== undefined) return held
      const next = aboutIn(jobs, recordId)
      aboutSnapshots.set(recordId, next)
      return next
    },

    live: () => liveSnapshot,
    all: () => jobs,

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    stopAll(): void {
      stopping = true
      try {
        for (const job of live(jobs)) {
          pending.get(job.id)?.stop?.()
          settle(job.id, 'cancelled')
        }
      } finally {
        // Cleared rather than latched: a provider may replace its registry
        // rather than drop it, and a registry that could never start again
        // would be a worse failure than the one this prevents.
        stopping = false
      }
    },
  }
}
