/**
 * The job queue, mounted above the router.
 *
 * ABOVE THE ROUTER is the whole point, and it is why this is a provider rather
 * than a hook: a registry inside a screen has the lifetime of that screen, which
 * is the defect `jobs.ts` was written to answer. `AgentRunsProvider` sits in the
 * same place in both apps for the same reason.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Cancellation } from '../agent/loop'
import { createJobs } from './jobs'
import type { JobsOptions } from './jobs'
import { JobsContext } from './jobs-context'

export function JobsProvider<S extends Cancellation>({
  children,
  ...options
}: JobsOptions<S> & { children: ReactNode }) {
  /*
   * `useState` with an initialiser, so the registry is built once per mount and
   * a changing `onSettled` identity cannot replace a queue mid-run. The options
   * are read at construction; a provider whose transport changes is a provider
   * that should be remounted.
   */
  const [jobs] = useState(() => createJobs<S>(options))

  useEffect(
    () => () => {
      // Whatever is in flight when this unmounts is in flight against a store
      // that is going away, so it is stopped rather than left writing into one.
      jobs.stopAll()
    },
    [jobs],
  )

  return <JobsContext value={jobs}>{children}</JobsContext>
}
