import { useCallback, useEffect, useState } from 'react'
import { Linking, StyleSheet, View } from 'react-native'
import { useTranslation } from 'react-i18next'
import { SettingRow, Toggle } from '@/components/ui/Field'
import { Panel, PanelTitle } from '@/components/ui/Surface'
import { Txt } from '@/components/ui/Text'
import { Button } from '@/components/ui/Button'
import { useColors } from '@/theme/theme-context'
import { radius, space } from '@/theme/tokens'
import {
  CRASH_CAPABILITY,
  clearCrashes,
  crashEnabled,
  readCrashes,
  setCrashEnabled,
} from '@/lib/crash'
import { ANALYTICS_CAPABILITY, analyticsEnabled, setAnalyticsEnabled } from '@/lib/analytics'
import type { CrashReport } from '@jojo/service/core/crash'
import { PRIVACY_URL } from '@jojo/service/core/privacy'

/**
 * The phone's copy of the web app's crash panel — and it says something
 * different, because on this platform the reports actually go somewhere.
 *
 * ## The copy is not the web copy, and that is the point
 *
 * `web/src/components/settings/CrashPanel.tsx` can say "stay on this device"
 * because Google ships no browser Crashlytics, so a web report has nowhere to
 * go. Here it does: the native SDK sends the redacted message and stack to
 * Firebase, and adds its own device profile and an install id on top. Reusing
 * the web's reassuring sentence on this screen would be the kind of copy that is
 * true in the file it was written for and false in the file it was pasted into.
 *
 * So this screen lists what Crashlytics adds, by name, and the claim it makes is
 * the narrow one that is actually true and actually checkable: no RECORD leaves.
 * `core/crash.ts` strips keys, paths and addresses before a report exists, and
 * `core/analytics.ts` has no free-text parameter for a record to travel in.
 *
 * ## Two switches, because they are two questions
 *
 * "Report crashes" and "share which features I use" are different bargains and a
 * person may reasonably take one and refuse the other. Bundling them into a
 * single "help improve jojo" is how consent stops meaning anything.
 */
export function CrashPanel() {
  const { t } = useTranslation(['components', 'common'])
  const c = useColors()
  const [on, setOn] = useState(false)
  const [usage, setUsage] = useState(false)
  const [reports, setReports] = useState<CrashReport[]>([])
  /*
   * Whether crash reports were turned off in THIS visit, which is when the
   * restart note below is true and worth saying. jojo's own reports stop at
   * once — `recordCrash` reads the switch every time — and unsent ones are
   * deleted, but Crashlytics' own native crash catcher reads its setting at
   * start-up: per `FIRCrashlytics.h`, a change "does not apply until the next
   * run of the app". Saying "off" without that would be a switch claiming more
   * than it did.
   */
  const [turnedOff, setTurnedOff] = useState(false)

  const refresh = useCallback(() => {
    void crashEnabled().then(setOn)
    void analyticsEnabled().then(setUsage)
    void readCrashes().then(setReports)
  }, [])

  // Storage on this platform is async, so unlike the web panel these cannot be
  // read during the first render.
  useEffect(refresh, [refresh])

  /*
   * A build compiled without reporting says so rather than showing a switch that
   * does nothing. See `core/crash-config.ts`: a build may only ever take away.
   */
  if (CRASH_CAPABILITY === 'off' && ANALYTICS_CAPABILITY === 'off') {
    return (
      <Panel focusId="settings.privacy">
        <PanelTitle hint={t('crash.thisPhone')}>{t('crash.title')}</PanelTitle>
        <Txt size="sm" tone="muted">
          {t('crash.notBuilt')}
        </Txt>
      </Panel>
    )
  }

  return (
    <Panel focusId="settings.privacy">
      <PanelTitle hint={t('crash.thisPhone')}>{t('crash.title')}</PanelTitle>

      <Txt size="sm" tone="muted" style={styles.para}>
        {t('crash.what')}
      </Txt>
      <Txt size="sm" tone="muted" style={styles.para}>
        {t('crash.where')}
      </Txt>

      {CRASH_CAPABILITY === 'off' ? null : (
        <SettingRow
          focusId="settings.privacy.crash"
          label={t('crash.report')}
          description={t('crash.reportHint')}
          control={
            <Toggle
              value={on}
              label={t('crash.report')}
              onValueChange={(next) => {
                setOn(next)
                setTurnedOff(!next)
                // Off also deletes reports not yet sent — see `lib/crash.ts`.
                void setCrashEnabled(next)
              }}
            />
          }
        />
      )}
      {turnedOff ? (
        <Txt size="xs" tone="muted" style={styles.fine}>
          {t('crash.restartNote')}
        </Txt>
      ) : null}

      {ANALYTICS_CAPABILITY === 'off' ? null : (
        <View style={styles.usage}>
          <SettingRow
            focusId="settings.privacy.usage"
            label={t('crash.usage')}
            description={t('crash.usageHint')}
            control={
              <Toggle
                value={usage}
                label={t('crash.usage')}
                onValueChange={(next) => {
                  setUsage(next)
                  // Applied to the SDK immediately, not at the next launch —
                  // see `lib/analytics.ts`.
                  void setAnalyticsEnabled(next)
                }}
              />
            }
          />
          <Txt size="xs" tone="muted" style={styles.fine}>
            {t('crash.usageDetail')}
          </Txt>
        </View>
      )}

      {reports.length > 0 ? (
        <View style={[styles.list, { borderColor: c.hairline }]}>
          <View style={[styles.listHead, { borderColor: c.hairline, backgroundColor: c.well }]}>
            <Txt size="xs" tone="muted">
              {t('crash.kept', { count: reports.length })}
            </Txt>
            <Button
              label={t('common:actions.clear')}
              variant="ghost"
              size="sm"
              onPress={() => {
                setReports([])
                void clearCrashes()
              }}
            />
          </View>
          {reports.map((report) => (
            <View key={report.id} style={[styles.item, { borderColor: c.hairline }]}>
              <Txt size="sm">{report.message}</Txt>
              <Txt size="xs" tone="muted" style={styles.meta}>
                {report.where} · {report.at.slice(0, 19).replace('T', ' ')}
              </Txt>
            </View>
          ))}
        </View>
      ) : (
        <Txt size="xs" tone="muted" style={styles.fine}>
          {on ? t('crash.nothingBroken') : t('crash.notRecording')}
        </Txt>
      )}

      {/* The full account — what each switch sends, to whom, for how long —
          is one link away rather than paraphrased here. The absolute address
          from `core/privacy.ts`, the same notice the setup sheet links. */}
      <Txt
        size="xs"
        tone="info"
        accessibilityRole="link"
        style={styles.privacy}
        onPress={() => {
          void Linking.openURL(PRIVACY_URL).catch(() => {
            /* No browser, or the user cancelled. Nothing is lost. */
          })
        }}
      >
        {t('crash.privacy')}
      </Txt>
    </Panel>
  )
}

const styles = StyleSheet.create({
  para: { marginBottom: space[2] },
  usage: { marginTop: space[1] },
  fine: { marginTop: space[1] },
  privacy: { marginTop: space[3] },
  list: { marginTop: space[3], borderWidth: 1, borderRadius: radius.md, overflow: 'hidden' },
  listHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
  },
  item: { borderTopWidth: 1, paddingHorizontal: space[3], paddingVertical: space[2] },
  meta: { marginTop: 2 },
})
