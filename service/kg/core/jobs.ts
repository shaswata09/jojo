/**
 * The state a piece of background work is in, and what may start next. L1 core.
 *
 * ## Why there is a queue at all
 *
 * A model call that writes something takes a minute on the box most people run
 * this against, and for that minute the person is expected to sit on the screen
 * that started it. They do not: they go and look at another application, and
 * the work was thrown away — the panel's effect cleanup aborted it on unmount,
 * so a tailored CV two-thirds written was lost to a click on a tab. That is the
 * complaint this exists to answer, and it is the same one `react/agent-runs.ts`
 * answers for conversations: work belongs to the app, not to the component that
 * asked for it.
 *
 * ## Why it is a QUEUE and not just a registry
 *
 * Because the thing doing the work is one small server on somebody's desk.
 * Three tailored documents asked for at once are three prompts of twenty
 * thousand characters at a box that answers about fourteen tokens a second: run
 * together they all finish late, and on a smaller card they do not all finish.
 * Run in order, the first is done in a minute and the person can read it while
 * the second is written. `LIMIT` is therefore one by default, and the reason it
 * is a number rather than a boolean is that a hosted model has no such problem.
 *
 * ## Why this half is pure
 *
 * Under D20 no component is mounted and no provider is either, so everything a
 * queue can get wrong — starting a second copy of the same job, starting one
 * while another is running, forgetting a run that is still going, growing
 * without bound — is decided here, over plain values, and asserted in
 * `jobs.test.ts`. `react/jobs.ts` holds the promises and the listeners and
 * nothing else.
 */

import type { Instant } from './model'

export type JobState =
  /** Accepted, waiting for a slot. */
  | 'queued'
  /** Started. Exactly `limit` jobs may be here at once. */
  | 'running'
  /** Finished, and what it was for is in the store. */
  | 'done'
  /** Finished without doing it. `error` says why, in the user's words. */
  | 'failed'
  /** A person stopped it. Not a failure, and never reported as one. */
  | 'cancelled'

export type Job = {
  /**
   * The job's identity, and what makes asking twice harmless.
   *
   * Built by the caller out of what the work is ABOUT rather than when it was
   * asked for — `tailor:<application>:<document>`, `fit:<document>#<attempt>` —
   * so a panel that re-renders, remounts, or is opened in a second tab of the
   * same record cannot queue the same work twice. It is the same trick
   * `fitRequestKey` already plays with a ref, done where a ref cannot be lost.
   */
  readonly id: string
  /** A family: 'tailor', 'fit'. What a screen filters on. */
  readonly kind: string
  /** One line, in the user's language: 'Tailoring your CV for Rice'. */
  readonly label: string
  /** The record this is for, so a screen can find its own. An application id. */
  readonly about: string
  readonly state: JobState
  /** What it is doing now — 'Opening the posting'. Absent before it starts. */
  readonly step?: string
  /** Why it failed, in the user's words. Only on `failed`. */
  readonly error?: string
  /**
   * Doubts the work raised about its own result. Only on `done`.
   *
   * Not an error — the thing was produced and saved. A tailored document whose
   * model marked nothing, or answered in the wrong language, is still the
   * person's document, and they are the ones who decide what to do about it.
   * Kept on the job because the run that knows these is over by the time
   * anybody is looking at the card, and because the person may be on another
   * screen when it finishes.
   */
  readonly notes?: readonly string[]
  /**
   * Whether finishing is worth telling the person about.
   *
   * True for work somebody asked for and then walked away from — that is the
   * whole feature: a tailored document written while they were on another
   * screen has to announce itself, or they never learn it is there. False for
   * work the app started on its own: the fit panel reads a posting the moment
   * it can, and a toast on every application opened would be the app talking
   * about its own housekeeping.
   *
   * Nothing announces a CANCELLED job. A person who stopped something does not
   * need to be told they stopped it.
   */
  readonly notify?: boolean
  readonly queuedAt: Instant
  readonly startedAt?: Instant
  readonly endedAt?: Instant
}

/** Settled one way or another. Nothing more will happen to it. */
export const isOver = (job: Job): boolean =>
  job.state === 'done' || job.state === 'failed' || job.state === 'cancelled'

/** Still going to happen, or happening. What a screen calls busy. */
export const isLive = (job: Job): boolean => !isOver(job)

/** How many run at once by default, and why. See the header. */
export const LIMIT = 1

/**
 * How many settled jobs are remembered.
 *
 * They are kept so a person who comes back to a record can see that the thing
 * they asked for finished, and failed ones so the reason survives the toast. A
 * list that only ever grew would be a leak in an app that stays open for days;
 * oldest first, which for an insertion-ordered list is the front.
 */
export const REMEMBERED = 40

/**
 * Add a job, or keep the one already there.
 *
 * A job that is queued or running is NOT replaced: pressing a button twice, or
 * a panel remounting under StrictMode, must not start the work again. A job
 * that has SETTLED is replaced, because asking again for something that failed
 * — or that succeeded and is being asked for a second time on purpose, which is
 * what Re-run is — is a new piece of work with the same name.
 */
export function enqueue(jobs: readonly Job[], job: Job): readonly Job[] {
  const existing = jobs.find((j) => j.id === job.id)
  if (existing !== undefined && isLive(existing)) return jobs
  return prune([...jobs.filter((j) => j.id !== job.id), job])
}

/**
 * Change one job. Unknown ids are ignored, as every other mutator here is.
 *
 * Pruned when the change SETTLES one, not only when a new job arrives: the cap
 * is on how many finished jobs are remembered, and a queue that is emptying —
 * which is every queue, eventually — adds nothing while it does it. Checked
 * against list order rather than `endedAt` because with a `limit` of one the
 * two agree, and the one that is settling here is the oldest live job, never
 * the oldest settled one.
 */
export function mark(
  jobs: readonly Job[],
  id: string,
  change: Partial<Job>,
  /*
   * Keys to DROP, because `Partial<Job>` cannot express one under
   * `exactOptionalPropertyTypes` — `{ step: undefined }` is not assignable, and
   * a stored `undefined` would survive as a present key anyway (D21). A job
   * that has finished must not keep saying what it was doing.
   */
  clear: readonly (keyof Job)[] = [],
): readonly Job[] {
  const next = jobs.map((j) => {
    if (j.id !== id) return j
    const merged: Record<string, unknown> = { ...j, ...change }
    for (const key of clear) delete merged[key]
    return merged as unknown as Job
  })
  return change.state !== undefined ? prune(next) : next
}

/** Forget one settled job. A live one is left alone — stop it first. */
export function forget(jobs: readonly Job[], id: string): readonly Job[] {
  return jobs.filter((j) => !(j.id === id && isOver(j)))
}

/**
 * The next job that may start, or undefined.
 *
 * In the order they were asked for, which is the only order a person can
 * predict. `limit` counts the RUNNING ones rather than the live ones: a queue
 * of six with one running has five waiting, and the answer is "one more only
 * when that one is finished".
 */
export function nextToStart(jobs: readonly Job[], limit: number = LIMIT): Job | undefined {
  const running = jobs.filter((j) => j.state === 'running').length
  if (running >= limit) return undefined
  return jobs.find((j) => j.state === 'queued')
}

/** Everything still to happen or happening, oldest first. */
export const live = (jobs: readonly Job[]): readonly Job[] => jobs.filter(isLive)

/** One record's jobs, newest last. What a panel renders. */
export const about = (jobs: readonly Job[], recordId: string): readonly Job[] =>
  jobs.filter((j) => j.about === recordId)

/** What a card says about one family of work: what is going, and what went wrong. */
export type WorkState = {
  /** The live job, or null. Queued counts — waiting is not idle. */
  readonly running: Job | null
  /** The failure worth showing, or null. */
  readonly error: string | null
  /** Doubts the newest finished job raised. Empty when there are none. */
  readonly notes: readonly string[]
}

/**
 * The rule a card follows, decided here rather than inside a hook.
 *
 * It was inside one, which under D20 meant nothing could assert it: dropping
 * the guard changed what a person saw and no test moved.
 *
 * The rule it replaces was "the newest FAILED job, whenever nothing of this
 * kind is live". That hides a failure only while something is running, so once
 * a later document finished successfully the older failure came back — a red
 * error under a card whose last two jobs both worked, naming a document the
 * person had moved on from.
 *
 * What this says instead: a failure is shown only when it is the NEWEST thing
 * to have finished. Anything else is describing the past.
 *
 * A CANCELLED job is transparent here, neither reported nor allowed to mask.
 * Somebody stopping something is not an outcome — a person who cancels a cover
 * letter has not thereby fixed the CV that failed before it, and hiding that
 * error would be the card quietly forgetting a thing that is still true.
 */
export function workState(jobs: readonly Job[], kind: string): WorkState {
  const mine = jobs.filter((j) => j.kind === kind)
  const running = mine.find(isLive) ?? null
  // Insertion order is the order they were asked for, so the last settled one
  // is the newest.
  const newest = [...mine].reverse().find((j) => j.state === 'done' || j.state === 'failed')
  return {
    running,
    error:
      running === null && newest?.state === 'failed' ? (newest.error ?? 'That did not finish.') : null,
    notes: running === null && newest?.state === 'done' ? (newest.notes ?? []) : [],
  }
}

/**
 * Drop the oldest settled jobs past `REMEMBERED`.
 *
 * Live ones are never dropped, however many there are: a queue longer than the
 * cap is a person who asked for a great deal, and forgetting what they asked
 * for would be worse than the list being long.
 */
export function prune(jobs: readonly Job[], keep: number = REMEMBERED): readonly Job[] {
  const settled = jobs.filter(isOver)
  if (settled.length <= keep) return jobs
  const dropping = new Set(settled.slice(0, settled.length - keep).map((j) => j.id))
  return jobs.filter((j) => !dropping.has(j.id))
}
