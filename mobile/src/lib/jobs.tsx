import { useRef } from 'react'
import type { ReactNode } from 'react'
import { JobsProvider } from '@jojo/service/react/jobs-provider'
import type { Job } from '@jojo/service/core/jobs'
import { reportError } from '@/lib/report-error'
import { useToast } from '@/lib/toast-context'

/**
 * The job queue, wired to this app's clock, cancellation and toast.
 *
 * The queue itself is `@jojo/service/react/jobs`, shared with the web. What
 * stays here is what cannot be shared: an `AbortController`, which `kg/react`
 * may not name; the wall clock, which D26 keeps out of `kg` entirely; and the
 * sentence a person reads when something they asked for finishes while they
 * were somewhere else — this app's toast takes an `onPress` where the web's
 * takes an `onClick`, which is why the two wrappers are not one file.
 */

/** A fresh controller, in the two-field shape the registry takes. */
const newSignal = () => {
  const stop = new AbortController()
  return {
    signal: stop.signal,
    abort: () => {
      stop.abort()
    },
  }
}

export function AppJobsProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast()
  /*
   * Through a ref, because the registry is built once per mount and reads its
   * options then. A toast raised through a stale closure is a toast into a
   * provider that may have been replaced; this always uses the current one.
   */
  const say = useRef(toast)
  say.current = toast

  const settled = (job: Job) => {
    // A person who pressed Cancel does not need to be told they pressed it,
    // and work the app started on its own is not news. See `Job.notify`.
    if (job.notify !== true || job.state === 'cancelled') return
    if (job.state === 'done') {
      say.current({
        title: `${job.label} is ready`,
        description: 'Saved under the application it was written for.',
      })
      return
    }
    if (job.state === 'failed') {
      say.current({
        title: `${job.label} did not finish`,
        description: job.error ?? '',
        tone: 'danger',
      })
    }
  }

  return (
    <JobsProvider
      newSignal={newSignal}
      now={() => new Date().toISOString()}
      onSettled={settled}
      onError={(thrown: unknown) => {
        // 'agent' rather than a kind of its own: everything on this queue is a
        // model doing something on the person's behalf.
        reportError('agent', thrown)
      }}
    >
      {children}
    </JobsProvider>
  )
}
