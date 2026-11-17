import { useState } from 'react'
import { View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'
import { CRASH_CAPABILITY, setCrashEnabled } from '@/lib/crash'
import { ANALYTICS_CAPABILITY, setAnalyticsEnabled } from '@/lib/analytics'

/**
 * The reporting question, asked once during setup.
 *
 * The phone's twin of `CrashStep` in `web/src/components/common/SetupSteps.tsx`,
 * and its copy differs for a real reason rather than by drift: on this platform
 * the reports actually leave the device. The web can say "stays here" because
 * Google ships no browser Crashlytics; here Crashlytics sends, and adds its own
 * device profile and install id on top. Saying the reassuring web sentence on
 * this screen would be false.
 *
 * ## Both switches start ON, matching what the app is already doing
 *
 * Showing two off switches while the app reports anyway is worse than not asking
 * — it tells somebody they have opted out when they have not. `CRASH_DEFAULTS`
 * is on, so these are on, and "Turn both off" is one press away.
 *
 * ## Two switches, because they are two questions
 *
 * "Tell us when it breaks" and "tell us what I do" are different bargains, and a
 * person may reasonably take one and refuse the other. Bundling them into a
 * single "help improve jojo" is how consent stops meaning anything.
 */
export function ReportingStep({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation('components')
  const c = useColors()
  const [crashes, setCrashes] = useState(true)
  const [usage, setUsage] = useState(true)

  const choose = (crashesOn: boolean, usageOn: boolean) => {
    void setCrashEnabled(crashesOn)
    void setAnalyticsEnabled(usageOn)
    onDone()
  }

  return (
    <Sheet
      open
      onClose={() => choose(crashes, usage)}
      title={t('reporting.title')}
      description={t('reporting.description')}
      footer={
        <>
          <Button
            label={t('reporting.bothOff')}
            variant="ghost"
            size="md"
            onPress={() => choose(false, false)}
          />
          <Button label={t('reporting.save')} size="md" onPress={() => choose(crashes, usage)} />
        </>
      }
    >
      {/* Taller than the sheet on a phone, and drawn through the footer — the
          last sentence lay on top of "Turn both off" — until `Sheet` scrolled
          its body. */}
      <View style={{ gap: space[2], paddingBottom: space[2] }}>
        {/*
          SPECIFIC RATHER THAN REASSURING, and the two are not the same thing.
          The easy copy here is "no personal data is collected", and it is the
          one sentence this feature is not allowed to say: Crashlytics sends a
          per-install identifier and a device profile, by design and by Google's
          own documentation. A promise a reader cannot check is worth less than a
          list they can, and this list is checkable — the reports are shown to
          them under Settings.
        */}
        <View
          style={{
            borderWidth: 1,
            borderColor: c.hairline,
            backgroundColor: c.well,
            borderRadius: radius.md,
            padding: space[3],
            gap: space[1],
          }}
        >
          <Txt size="xs">{t('reporting.inReport')}</Txt>
          <Txt size="xs" tone="muted">
            {t('reporting.in.message')}
          </Txt>
          <Txt size="xs" tone="muted">
            {t('reporting.in.stack')}
          </Txt>
          <Txt size="xs" tone="muted">
            {t('reporting.in.device')}
          </Txt>
          <Txt size="xs" style={{ marginTop: space[2] }}>
            {t('reporting.notInReport')}
          </Txt>
          <Txt size="xs" tone="muted">
            {t('reporting.notIn.records')}
          </Txt>
          <Txt size="xs" tone="muted">
            {t('reporting.notIn.secrets')}
          </Txt>
        </View>

        {CRASH_CAPABILITY === 'off' ? null : (
          <SettingRow
            label={t('crash.report')}
            description={t('reporting.crashHint')}
            control={
              <Toggle value={crashes} onValueChange={setCrashes} label={t('crash.report')} />
            }
          />
        )}

        {ANALYTICS_CAPABILITY === 'off' ? null : (
          <>
            <SettingRow
              label={t('crash.usage')}
              description={t('reporting.usageHint')}
              control={<Toggle value={usage} onValueChange={setUsage} label={t('crash.usage')} />}
            />
            <Txt size="xs" tone="muted">
              {t('reporting.usageDetail')}
            </Txt>
          </>
        )}

        <Txt size="xs" tone="muted">
          {t('reporting.later')}
        </Txt>
      </View>
    </Sheet>
  )
}
