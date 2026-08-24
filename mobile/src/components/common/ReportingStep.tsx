import { useState } from 'react'
import { View } from 'react-native'
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
/**
 * Whether there is anything to ask at all.
 *
 * Read by the onboarding sequencer BEFORE this component is mounted, rather
 * than returning `null` from the render. A step that renders nothing and never
 * calls `onDone` is a step the flow stops on: the stage is never marked, so the
 * tour is never offered and setup ends silently on a blank screen. Deciding it
 * outside means the sequencer simply moves to the next question.
 */
export const REPORTING_ASKABLE = CRASH_CAPABILITY !== 'off' || ANALYTICS_CAPABILITY !== 'off'

export function ReportingStep({ onDone }: { onDone: () => void }) {
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
      title="Crash reports and usage"
      description="Two separate things, both on. Turn off either one here or later in Settings. Neither can carry your records: not an application, a document, a note, a profile or a conversation."
      footer={
        <>
          <Button
            label="Turn both off"
            variant="ghost"
            size="md"
            onPress={() => choose(false, false)}
          />
          <Button label="Save choices" size="md" onPress={() => choose(crashes, usage)} />
        </>
      }
    >
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
          <Txt size="xs">What is in a crash report</Txt>
          <Txt size="xs" tone="muted">· The error message and where in jojo it happened.</Txt>
          <Txt size="xs" tone="muted">· The stack trace, which names the code that failed.</Txt>
          <Txt size="xs" tone="muted">
            · Your device model, its OS version, and a random id used to count how many people hit
            the same crash — no name, no account.
          </Txt>
          <Txt size="xs" style={{ marginTop: space[2] }}>What is never in one</Txt>
          <Txt size="xs" tone="muted">
            · Your applications, documents, notes, profile or conversations.
          </Txt>
          <Txt size="xs" tone="muted">
            · Your API keys, the addresses you use, or any email address — stripped out before a
            report is written, not before it is sent.
          </Txt>
        </View>

        {CRASH_CAPABILITY === 'off' ? null : (
          <SettingRow
            label="Report crashes"
            description="The error and where it happened. Goes to Firebase Crashlytics."
            control={
              <Toggle value={crashes} onValueChange={setCrashes} label="Report crashes" />
            }
          />
        )}

        {ANALYTICS_CAPABILITY === 'off' ? null : (
          <>
            <SettingRow
              label="Share which features I use"
              description="Counts only — which screens are opened, how often. Never what is in them."
              control={
                <Toggle
                  value={usage}
                  onValueChange={setUsage}
                  label="Share which features I use"
                />
              }
            />
            <Txt size="xs" tone="muted">
              The second one is the only thing jojo sends about what you DO, and it can only ever
              say things from a fixed list — “the vault was opened”, “an application was added”,
              “there are 6–20 of them”. It cannot name an employer, a role, a file or anything you
              typed, because those words are not in the list. Turning it off also stops the screen
              views Firebase would otherwise collect on its own.
            </Txt>
          </>
        )}

        <Txt size="xs" tone="muted">
          Both are under Settings whenever you want to change them, and turning one off discards
          what it kept.
        </Txt>
      </View>
    </Sheet>
  )
}
