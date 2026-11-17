import { ListFilter, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useRoles } from '@/lib/roles-context'

/**
 * What a chart shows when the role filter has left it nothing to count.
 *
 * Without it each panel fell through to its first-run state, "Add one and the
 * first bar appears", on a store holding dozens of applications.
 */
export function RoleScopeEmpty() {
  const { clear } = useRoles()
  const { t } = useTranslation('messages')
  return (
    <EmptyState
      icon={ListFilter}
      title={t('roleScopeEmpty.title')}
      description={t('roleScopeEmpty.description')}
      action={
        <Button variant="outline" size="sm" onClick={clear}>
          <X className="size-3.5" strokeWidth={2} aria-hidden />
          {t('roleScopeEmpty.showAll')}
        </Button>
      }
    />
  )
}
