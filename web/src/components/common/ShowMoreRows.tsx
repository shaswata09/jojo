import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** The foot of a capped list: mounts the next page. Renders nothing when nothing is hidden. */
export function ShowMoreRows({
  shown,
  hidden,
  onMore,
}: {
  shown: number
  hidden: number
  onMore: () => void
}) {
  const { t } = useTranslation()
  if (hidden <= 0) return null
  return (
    <div className="flex justify-center pt-3">
      <Button variant="ghost" size="sm" onClick={onMore}>
        {t('rows.showMore', { shown, total: shown + hidden })}
      </Button>
    </div>
  )
}
