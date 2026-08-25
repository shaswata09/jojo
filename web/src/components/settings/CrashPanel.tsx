import { useState } from 'react'
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
      <Panel className="min-w-0">
        <PanelTitle hint="this browser only">Crash reports</PanelTitle>
        <p className="text-sm text-text-2">
          This copy of jojo was built without crash reporting or usage analytics, so nothing is
          recorded and there is nothing to turn on. A build sets those with{' '}
          <span className="font-mono">VITE_CRASH_REPORTING</span> and{' '}
          <span className="font-mono">VITE_ANALYTICS</span>.
        </p>
      </Panel>
    )
  }

  return (
    <Panel className="min-w-0">
      <PanelTitle hint="this browser only">Crash reports</PanelTitle>
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
      <p className="mb-2 text-sm text-text-2">
        When something breaks, jojo can keep the error so you can read it back — useful when the
        thing that failed has already scrolled away. A report holds the error message, where in jojo
        it happened, and the stack trace. It never holds your applications, documents, notes,
        profile or conversations, and API keys, addresses, your home directory and email addresses
        are stripped out before a report is written.
      </p>
      <p className="mb-3 text-sm text-text-2">
        In this browser and in the extension, crash reports <span className="text-text-1">stay on
        this device</span> — nothing is uploaded, and a backup file does not carry them. The phone app
        also sends them to Firebase Crashlytics, which adds the device model, its OS version and a
        random id used to count how many people hit the same crash. Crash reports are about crashes
        only — what you do in jojo is the separate question below, answered separately.
      </p>

      <SettingRow
        label="Keep crash reports"
        description="On, so a crash you hit is one we can see. Turn it off and nothing is recorded."
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
            aria-label="Keep crash reports"
          />
        }
      />
        </>
      )}

      {ANALYTICS_CAPABILITY === 'off' ? null : (
        <div className="mt-1">
          <SettingRow
            label="Share which features I use"
            description="Counts only, from a fixed list — never what is in your records."
            control={
              <Switch
                checked={usage}
                onCheckedChange={(next) => {
                  setAnalyticsEnabled(next)
                  setUsage(next)
                }}
                aria-label="Share which features I use"
              />
            }
          />
          {/* Said here as well as in setup, because this is where somebody comes
              to check what they agreed to — and a claim that only appears at the
              moment of consent is a claim nobody can re-read. */}
          <p className="mt-1 text-xs text-text-3">
            It can only say things from a fixed list — which screen was opened, that an application
            was added, roughly how many there are. It cannot name an employer, a role, a file or
            anything you typed. Goes to Google Analytics.
          </p>
        </div>
      )}

      {reports.length > 0 ? (
        <div className="mt-4 overflow-hidden rounded-lg border border-hairline">
          <div className="flex items-center justify-between gap-2 border-b border-hairline bg-well px-3 py-2">
            <p className="text-xs text-text-3">
              {reports.length === 1 ? '1 report kept' : `${reports.length} reports kept`}
            </p>
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
              Clear
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
                    <summary className="cursor-pointer text-xs text-text-3">Stack</summary>
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
        <p className="mt-3 text-xs text-text-3">
          {on ? 'Nothing has broken since you turned this on.' : 'Nothing is being recorded.'}
        </p>
      )}
    </Panel>
  )
}
