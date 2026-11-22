import { useEffect, useState } from 'react'
import { Linking, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/Button'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'
import { CRASH_CAPABILITY, crashEnabled, setCrashEnabled } from '@/lib/crash'
import { ANALYTICS_CAPABILITY, analyticsEnabled, setAnalyticsEnabled } from '@/lib/analytics'
import { PRIVACY_URL } from '@jojo/service/core/privacy'

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
 * ## Both switches start OFF, and every way out that is not "Save" means no
 *
 * They used to start on, matching a default of on, on the argument that two
 * off switches over an app that reports anyway would lie. The argument still
 * holds and the default moved instead: the owner reversed it on 2026-11-21,
 * because a switch already on when somebody first sees it is a pre-ticked box
 * and a pre-ticked box is not consent (CJEU, Planet49). `core/crash-config.ts`
 * has the reasoning. So these start off, the app does not report, and the
 * switches and the app still agree.
 *
 * Dismissing the sheet — Back, the backdrop, the close button — records NO for
 * both, the same as the web's `CrashStep`. It used to save whatever the
 * switches showed, which with switches that started on was a yes collected
 * from somebody pressing Back to get past a sheet. Saying no to a question you
 * did not read is the only safe reading of a dismissal; saying yes is the one
 * reading a consent question must never make.
 *
 * "Turn both off" and "Save choices" are the same weight, for the same reason:
 * refusing has to be as easy and as visible as agreeing.
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
  // Off to begin with, which is the default and what the app is doing. Then
  // the stored answer, if there somehow is one — the stage marker and the
  // answer are separate writes and can land apart — so the switches never
  // show a different answer from the one in force. Same rule as the web's
  // `CrashStep`, which reads the live setting; storage is async here.
  const [crashes, setCrashes] = useState(false)
  const [usage, setUsage] = useState(false)
  useEffect(() => {
    let live = true
    void crashEnabled().then((on) => {
      if (live) setCrashes(on)
    })
    void analyticsEnabled().then((on) => {
      if (live) setUsage(on)
    })
    return () => {
      live = false
    }
  }, [])

  const choose = (crashesOn: boolean, usageOn: boolean) => {
    void setCrashEnabled(crashesOn)
    void setAnalyticsEnabled(usageOn)
    onDone()
  }

  return (
    <Sheet
      open
      onClose={() => choose(false, false)}
      title={t('reporting.title')}
      description={t('reporting.description')}
      footer={
        <>
          <Button
            label={t('reporting.bothOff')}
            variant="outline"
            size="md"
            onPress={() => choose(false, false)}
          />
          <Button
            label={t('reporting.save')}
            variant="outline"
            size="md"
            onPress={() => choose(crashes, usage)}
          />
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
        {/* The full notice, in the browser. The absolute address, because the
            phone has no copy of the page to resolve a relative one against. */}
        <Txt
          size="xs"
          tone="info"
          accessibilityRole="link"
          onPress={() => {
            void Linking.openURL(PRIVACY_URL).catch(() => {
              /* No browser, or the user cancelled. Nothing is lost. */
            })
          }}
        >
          {t('reporting.privacy')}
        </Txt>
      </View>
    </Sheet>
  )
}
