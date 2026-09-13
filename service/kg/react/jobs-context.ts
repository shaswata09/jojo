/**
 * L4 — reaching the job queue from a screen.
 *
 * Split from `jobs.ts` for the reason `agent-runs-context.ts` is split from
 * `agent-runs.ts`: the registry is a plain closure that a test can drive with
 * no tree at all, and the hooks that subscribe to it are the only part that
 * needs React. `useSyncExternalStore` compares what the getter returns, so
 * every getter here is one the registry memoises.
 */

import { createContext, useContext, useSyncExternalStore } from 'react'
import type { Job } from '../core/jobs'
import type { Jobs } from './jobs'

export const JobsContext = createContext<Jobs | null>(null)

export function useJobs(): Jobs {
  const jobs = useContext(JobsContext)
  if (!jobs) throw new Error('useJobs must be used inside a JobsProvider.')
  return jobs
}

/** One job, by id. `undefined` once it has been forgotten, or was never queued. */
export function useJob(id: string | null): Job | undefined {
  const jobs = useJobs()
  return useSyncExternalStore(
    jobs.subscribe,
    () => (id === null ? undefined : jobs.get(id)),
    () => undefined,
  )
}

/** Every job for one record, oldest first. What a panel renders. */
export function useJobsAbout(recordId: string): readonly Job[] {
  const jobs = useJobs()
  return useSyncExternalStore(
    jobs.subscribe,
    () => jobs.about(recordId),
    () => jobs.about(recordId),
  )
}

/** Everything queued or running, so a shell can say the app is busy. */
export function useLiveJobs(): readonly Job[] {
  const jobs = useJobs()
  return useSyncExternalStore(jobs.subscribe, jobs.live, jobs.live)
}
