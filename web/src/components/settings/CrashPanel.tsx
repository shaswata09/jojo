import { useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { SettingRow } from '@/components/common/Field'
import { Switch } from '@/components/ui/switch'
import {
  CRASH_CAPABILITY,
  clearCrashes,
  crashEnabled,
  readCrashes,
  setCrashEnabled,
} from '@/lib/crash-log'
import { syncExtensionCrashReporting } from '@/lib/capture-bridge'
import { ANALYTICS_CAPABILITY, analyticsEnabled, setAnalyticsEnabled } from '@/lib/analytics'

/**
 * Crash reports, and the switch that decides whether there are any.
 *
 * WHAT THIS PANEL IS NOT. It is not a telemetry consent dialog, because nothing
 * is transmitted: Google ships no browser Crashlytics — Apple platforms,
 * Android, Flutter, Unity and the Android NDK, and nothing that runs in a page —
 * so the web app's reports stay here. The phone's copy of this setting does feed
 * Crashlytics, and says so on its own screen.
 *
 * The copy therefore has to be exact rather than reassuring. "Kept on this
 * device" is a fact a reader can check by reading the list underneath it, and
 * saying anything vaguer would be borrowing credibility the feature has not
 * earned.
 */
export function CrashPanel() {
  const { t } = useTranslation('settings')
  const [on, setOn] = useState(crashEnabled)
  const [usage, setUsage] = useState(analyticsEnabled)
  const [reports, setReports] = useState(readCrashes)

  /*
   * A build with reporting compiled out says so instead of offering a switch
   * that cannot do anything. `core/crash-config.ts` explains why a build may
   * only ever take away — and a disabled control with no explanation is the
   * thing people file bugs about.
   */
  if (CRASH_CAPABILITY === 'off' && ANALYTICS_CAPABILITY === 'off') {
    return (
      <Panel className="min-w-0" focusId="crash">
        <PanelTitle hint={t('shared.thisBrowserOnly')}>{t('crash.title')}</PanelTitle>
        <p className="text-sm text-text-2">
          <Trans
            t={t}
            i18nKey="crash.builtWithout"
            values={{ crashFlag: 'VITE_CRASH_REPORTING', analyticsFlag: 'VITE_ANALYTICS' }}
            components={{ mono: <span className="font-mono" /> }}
          />
        </p>
      </Panel>
    )
  }

  return (
    <Panel className="min-w-0" focusId="crash">
      <PanelTitle hint={t('shared.thisBrowserOnly')}>{t('crash.title')}</PanelTitle>
      {/* Each half is gated on its OWN capability, and the two are separate
          builds' worth of decision. Gating the whole panel on CRASH_CAPABILITY
          — which is what this did — meant a build with VITE_ANALYTICS set and
          VITE_CRASH_REPORTING unset rendered the "nothing to turn on" message
          while analytics reported to Google by default, with no switch anywhere
          to stop it. That is the one arrangement this feature must not produce. */}
      {CRASH_CAPABILITY === 'off' ? null : (
        <>
          {/* The same words as the setup step, because a person who reads both and
          finds them different has learned that one of them is marketing. */}
          <p className="mb-2 text-sm text-text-2">{t('crash.intro')}</p>
          <p className="mb-3 text-sm text-text-2">
            <Trans
              t={t}
              i18nKey="crash.where"
              components={{ em: <span className="text-text-1" /> }}
            />
          </p>

          <SettingRow
            focusId="crash-keep"
            label={t('crash.keep.label')}
            description={t('crash.keep.description')}
            control={
              <Switch
                checked={on}
                onCheckedChange={(next) => {
                  setCrashEnabled(next)
                  setOn(next)
                  // The extension is the other half of the same answer. It cannot
                  // read this setting, so it is told — and told to throw away what
                  // it kept when the answer becomes no.
                  void syncExtensionCrashReporting(next, !next)
                }}
                aria-label={t('crash.keep.label')}
              />
            }
          />
        </>
      )}

      {ANALYTICS_CAPABILITY === 'off' ? null : (
        <div className="mt-1">
          <SettingRow
            focusId="crash-usage"
            label={t('crash.usage.label')}
            description={t('crash.usage.description')}
            control={
              <Switch
                checked={usage}
                onCheckedChange={(next) => {
                  setAnalyticsEnabled(next)
                  setUsage(next)
                }}
                aria-label={t('crash.usage.label')}
              />
            }
          />
          {/* Said here as well as in setup, because this is where somebody comes
              to check what they agreed to — and a claim that only appears at the
              moment of consent is a claim nobody can re-read. */}
          <p className="mt-1 text-xs text-text-3">{t('crash.usage.note')}</p>
        </div>
      )}

      {reports.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
          <div className="flex items-center justify-between gap-2 border-b border-hairline bg-well px-3 py-2">
            <p className="text-xs text-text-3">{t('crash.kept', { count: reports.length })}</p>
            <button
              type="button"
              className="flex cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-xs text-text-3 transition-colors hover:text-danger"
              onClick={() => {
                clearCrashes()
                setReports([])
                void syncExtensionCrashReporting(on, true)
              }}
            >
              <Trash2 className="size-3" strokeWidth={1.8} aria-hidden />
              {t('crash.clear')}
            </button>
          </div>
          <ul className="divide-y divide-hairline">
            {reports.map((report) => (
              <li key={report.id} className="px-3 py-2">
                <p className="text-sm wrap-anywhere text-text-1">{report.message}</p>
                <p className="mt-0.5 text-xs text-text-3">
                  {report.where} · {report.at.slice(0, 19).replace('T', ' ')}
                </p>
                {/* The stack is the useful half for whoever reads the report and
                    noise for everybody else, so it is there and folded away. */}
                {report.stack ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-text-3">
                      {t('crash.stack')}
                    </summary>
                    <pre className="mt-1 max-h-48 overflow-auto rounded-md bg-well p-2 font-mono text-xs whitespace-pre-wrap text-text-2">
                      {report.stack}
                    </pre>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-xs text-text-3">{on ? t('crash.emptyOn') : t('crash.emptyOff')}</p>
      )}
    </Panel>
  )
}
