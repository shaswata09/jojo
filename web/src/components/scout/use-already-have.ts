import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useKg } from '@jojo/service/react/kg-context'
import { appPath } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { findSameJob } from '@jojo/service/core/same-job'
import type { JobIdentity } from '@jojo/service/core/same-job'
import { alreadyHaveDescription } from './scout-approval'
import { useMascot } from '@/lib/mascot-context'
import { CUES } from '@/lib/mascot-cues'

/**
 * The application a job already is, if any, and the toast that says so.
 */
export function useAlreadyHave() {
  const kg = useKg()
  const { t } = useTranslation('scout')
  const { toast } = useToast()
  const mascot = useMascot()
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
  ) => {
    mascot.play(CUES.alreadyHave)
    toast({
      title: t('toasts.alreadyHaveTitle'),
      description: alreadyHaveDescription(existing),
      action: { label: t('common.open'), onClick: () => navigate(appPath(target)) },
    })
  }

  return { alreadyHave, sayAlreadyHave }
}
