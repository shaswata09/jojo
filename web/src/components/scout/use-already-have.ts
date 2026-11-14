import { useNavigate } from 'react-router'
import { useKg } from '@jojo/service/react/kg-context'
import { appPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { findSameJob } from '@jojo/service/core/same-job'
import type { JobIdentity } from '@jojo/service/core/same-job'
import { alreadyHaveDescription } from './scout-approval'

/**
 * The application a job already is, if any, and the toast that says so.
 */
export function useAlreadyHave() {
  const kg = useKg()
  const { toast } = useToast()
  const navigate = useNavigate()

  /**
   * The application this job already is, if any — the same job under another
   * board's address (`core/same-job.ts`). Read from the store itself, not this
   * render's list: Approve all makes several drafts in one handler, and the
   * second must see the first.
   */
  const alreadyHave = (job: JobIdentity) => {
    const apps = kg.projections.applications(kg.repo.getSnapshot())
    return findSameJob(apps, job)?.record ?? null
  }

  /** Said once a job turned out to be one already in the applications. */
  const sayAlreadyHave = (
    existing: { org: string; role: string },
    target: Parameters<typeof appPath>[0],
  ) =>
    toast({
      title: `Already in your applications — not added again`,
      description: alreadyHaveDescription(existing),
      action: { label: 'Open', onClick: () => navigate(appPath(target)) },
    })

  return { alreadyHave, sayAlreadyHave }
}
