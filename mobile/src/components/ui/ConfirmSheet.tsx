import { View } from 'react-native'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { space } from '@/theme/tokens'

/**
 * The guard for a write with no undo behind it.
 *
 * Used sparingly and on purpose: everything the store can restore gets an undo
 * toast instead, because a confirmation fires on the way out of the one path a
 * user takes when they have already decided. The three writes that reach this
 * are the ones the reducer cannot walk back — clearing the store, reseeding it,
 * and deleting an application, which also gets an undo because the two guards
 * catch different mistakes.
 */
export function ConfirmSheet({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  tone = 'default',
  onConfirm,
}: {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  tone?: 'default' | 'danger'
  onConfirm: () => void
}) {
  return (
    <Sheet open={open} onClose={onClose} title={title} description={description}>
      <View style={{ flexDirection: 'row', gap: space[2], paddingBottom: space[2] }}>
        <Button label="Cancel" variant="outline" size="md" onPress={onClose} style={{ flex: 1 }} />
        <Button
          label={confirmLabel}
          size="md"
          variant={tone === 'danger' ? 'destructive' : 'default'}
          style={{ flex: 1 }}
          onPress={() => {
            onClose()
            onConfirm()
          }}
        />
      </View>
    </Sheet>
  )
}
