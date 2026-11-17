import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { TriangleAlert } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { dashboardPath } from '@/lib/links'

/**
 * What one broken view looks like, with the rest of the app still standing.
 *
 * The distinction this exists to draw: the root boundary's screen means "jojo
 * is gone", and this one means "this page is". Everything around it — sidebar,
 * navigation, the palette — is still there, so the honest thing to offer is
 * somewhere else to go rather than a Try again that re-renders the same throw.
 *
 * DELIBERATELY PROMISES NOTHING ABOUT THE RECORDS, for the reason the root
 * boundary's copy sets out at length: a crash part-way through a multi-write
 * can leave the store half-edited, and "your data is safe" would be a guess.
 * What it can say truthfully is that this failure was in the drawing.
 */
export function RouteFailure() {
  const { t } = useTranslation()
  return (
    <>
      <PageHeader title={t('routeFailure.title')} subtitle={t('routeFailure.subtitle')} />
      <Panel>
        <EmptyState
          icon={TriangleAlert}
          title={t('routeFailure.emptyTitle')}
          description={t('routeFailure.emptyDescription')}
          action={
            <Button size="sm" asChild>
              <Link to={dashboardPath()}>{t('routeFailure.back')}</Link>
            </Button>
          }
        />
      </Panel>
    </>
  )
}
