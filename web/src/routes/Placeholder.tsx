import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Compass } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { PageHeader } from '@/components/common/PageHeader'
import { Button } from '@/components/ui/button'
import { dashboardPath, useTitle } from '@/lib/links'

/**
 * The catch-all route.
 *
 * It used to be the stand-in for several unbuilt views as well; those are all
 * real pages now, and the one that never became one — Chat — was removed along
 * with the topbar icon that led to it. So this is only ever reached by a URL
 * that matches nothing, which is exactly when a way out matters most: the
 * sidebar is a drawer below `lg`, so on a phone there was nothing on screen to
 * press.
 */
export function Placeholder(props: { title?: string; subtitle?: string }) {
  const { t } = useTranslation('pages')
  const title = props.title ?? t('notFound.title')
  const subtitle = props.subtitle ?? t('notFound.subtitle')
  // Every other route titles itself, so a mistyped URL was the one page that
  // left the tab reading "jojo — agentic job-search assistant" while the page
  // itself said "Not found". A background tab has nothing but its title.
  useTitle(title)

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} />
      <Panel>
        <EmptyState
          icon={Compass}
          title={t('notFound.emptyTitle')}
          description={t('notFound.emptyDescription')}
          action={
            <Button size="sm" asChild>
              <Link to={dashboardPath()}>{t('notFound.back')}</Link>
            </Button>
          }
        />
      </Panel>
    </>
  )
}
