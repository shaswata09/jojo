import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { space } from '@/theme/tokens'

/**
 * The foot of a capped list (`useRowCap`): mounts the next page. Renders
 * nothing when nothing is hidden, so a list under one page looks as it did.
 */
export function ShowMoreRows({
  shown,
  hidden,
  onMore,
}: {
  shown: number
  hidden: number
  onMore: () => void
}) {
  const { t } = useTranslation('common')
  if (hidden <= 0) return null
  return (
    <View style={{ alignItems: 'center', paddingVertical: space[2] }}>
      <Button
        label={t('rows.showMore', { shown, total: shown + hidden })}
        variant="ghost"
        onPress={onMore}
      />
    </View>
  )
}
