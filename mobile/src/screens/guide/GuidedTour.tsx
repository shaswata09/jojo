import { useState } from 'react'
import { View } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { TOUR_STEPS } from '@/screens/guide/tour-steps'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The guided tour, as a sheet.
 *
 * The phone had none — the web app has had a seven-step tour since the guide was
 * written, and reaching this platform it became six steps about the things a
 * phone actually has. `tour-steps.ts` carries the copy and the argument for why
 * the two sets differ.
 *
 * WHY A SHEET AND NOT AN OVERLAY. A coach-mark walking across the app has to be
 * mounted above the navigator and has to know where a control is on screen;
 * both hold only while the right screen is showing, so it spends most of its
 * life pointing at nothing. A sheet is honest about being a thing you read.
 *
 * WHERE PROGRESS LIVES. AsyncStorage, beside the onboarding flags and the model
 * settings — not the graph. "How far through a tutorial you are" is not a record
 * the user authored: in the graph it would show up in the audit log as a write
 * they did not make, ride along in a backup and cross to the other device on
 * Transfer. `web/src/components/guide/tour/progress.ts` argues the same thing at
 * length for the browser.
 *
 * The stored index is CLAMPED on read for the reason that file gives: steps get
 * added and removed, the stored number does not, and a stale one must not
 * strand the reader on a step that no longer exists.
 */

const PROGRESS_KEY = 'jojo/tour/step'

export function GuidedTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const c = useColors()
  const [index, setIndex] = useState(0)

  // Read once, when the sheet opens. Deliberately not an effect on `open`
  // alone: re-reading on every render would fight the user's own Next presses.
  const [restored, setRestored] = useState(false)
  if (open && !restored) {
    setRestored(true)
    void AsyncStorage.getItem(PROGRESS_KEY)
      .then((raw) => {
        const parsed = Number.parseInt(raw ?? '', 10)
        if (Number.isFinite(parsed) && parsed > 0 && parsed < TOUR_STEPS.length) setIndex(parsed)
      })
      .catch(() => {})
  }

  const step = TOUR_STEPS[index]
  const last = index === TOUR_STEPS.length - 1
  if (!step) return null

  const go = (next: number) => {
    setIndex(next)
    void AsyncStorage.setItem(PROGRESS_KEY, String(next)).catch(() => {})
  }

  const finish = () => {
    // Cleared rather than left at the end, so reopening starts over instead of
    // dropping the reader on the last page of something they finished.
    void AsyncStorage.removeItem(PROGRESS_KEY).catch(() => {})
    setRestored(false)
    setIndex(0)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="tall"
      title={step.title}
      description={step.lede}
      footer={
        <>
          <Button
            label="Back"
            variant="ghost"
            size="md"
            disabled={index === 0}
            onPress={() => go(index - 1)}
          />
          {last ? (
            <Button label="Done" size="md" onPress={finish} />
          ) : (
            <Button label="Next" size="md" onPress={() => go(index + 1)} />
          )}
        </>
      }
    >
      <View style={{ gap: space[3], paddingBottom: space[2] }}>
        <View style={s.row}>
          <Feather name={step.icon} size={15} color={c.accent} />
          <Txt size="xs" tone="muted">
            Step {index + 1} of {TOUR_STEPS.length}
          </Txt>
        </View>

        {/* A row of bars rather than a number alone: six steps is short enough
            that seeing how much is left is what decides whether someone starts. */}
        <View style={{ flexDirection: 'row', gap: space[1] }}>
          {TOUR_STEPS.map((entry, at) => (
            <View
              key={entry.id}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                backgroundColor: at <= index ? c.accent : c.hairline,
              }}
            />
          ))}
        </View>

        {step.body.map((paragraph) => (
          <Txt key={paragraph.slice(0, 32)} size="sm" tone="secondary">
            {paragraph}
          </Txt>
        ))}
      </View>
    </Sheet>
  )
}
