import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useStoreAdmin } from '@jojo/service/react/use-admin'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The one decision this app makes the user take, on the one launch where it is
 * free.
 *
 * Until the store went to the device this question could not be asked. The
 * fixtures were rebuilt in memory on every launch, so "start empty" was a button
 * that worked until you closed the app — and with nothing able to remember an
 * answer, asking for one would have been a sheet that came back every morning.
 * The meta row `boot()` writes is what makes it answerable exactly once.
 *
 * **This is not a confirmation, and is styled as one on purpose nowhere.** It
 * looks like one — a sheet over the app with a destructive-sounding option — and
 * it is the opposite. A confirmation guards work the user authored, and on a
 * first run there is none: the records behind this scrim are fixtures they have
 * never seen, minted by `boot()` a moment ago. So there is no danger tone, no
 * Cancel, and nothing behind "Start empty" asking again. This app reserves a
 * confirm for irreversible loss of authored work, and ceremony spent where
 * nothing is at stake is what teaches people to tap through the ones that
 * matter.
 *
 * Dismissing it by the backdrop keeps the demo records, which is the same thing
 * the first button does. That is deliberate: the sheet is a question with a safe
 * default, not a gate, and someone who taps outside it has not lost anything.
 */
export function FirstRunChoice({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('components')
  const c = useColors()
  const { clearAll } = useStoreAdmin()
  const [open, setOpen] = useState(true)

  const close = () => {
    setOpen(false)
    onDone()
  }

  const startEmpty = () => {
    clearAll()
    close()
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title={t('firstRun.title')}
      description={t('firstRun.description')}
    >
      <View style={{ gap: space[3], paddingBottom: space[2] }}>
        <Choice
          icon="sparkles"
          title={t('firstRun.demo.title')}
          detail={t('firstRun.demo.detail')}
          color={c.accent}
        />
        <Button label={t('firstRun.demo.action')} full onPress={close} />

        <Choice
          icon="square"
          title={t('firstRun.empty.title')}
          detail={t('firstRun.empty.detail')}
          color={c.text3}
        />
        <Button label={t('firstRun.empty.title')} variant="outline" full onPress={startEmpty} />
      </View>
    </Sheet>
  )
}

function Choice({
  icon,
  title,
  detail,
  color,
}: {
  icon: 'sparkles' | 'square'
  title: string
  detail: string
  color: string
}) {
  return (
    <View style={{ gap: space[1.5] }}>
      <View style={s.row}>
        <Feather name={icon === 'sparkles' ? 'star' : 'square'} size={16} color={color} />
        <Txt size="base" weight="medium" style={s.fill}>
          {title}
        </Txt>
      </View>
      <Txt size="sm" tone="secondary">
        {detail}
      </Txt>
    </View>
  )
}
