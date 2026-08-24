import { useEffect, useState } from 'react'
import { View } from 'react-native'
import { Feather } from '@react-native-vector-icons/feather/static'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { Txt } from '@/components/ui/Text'
import { REPORTING_ASKABLE, ReportingStep } from '@/components/common/ReportingStep'
import { WelcomeDetails } from '@/components/common/WelcomeDetails'
import { GuidedTour } from '@/screens/guide/GuidedTour'
import { markOffered, readOffered } from '@/lib/onboarding'
import type { OnboardingStage } from '@/lib/onboarding'
import { useProfile } from '@/lib/store-context'
import { s } from '@/theme/styles'
import { useColors } from '@/theme/theme-context'
import { space } from '@/theme/tokens'

/**
 * The first minute, as three questions in order.
 *
 *   1. Which records to start from   — `FirstRunChoice`, which owns the screen
 *   2. Who you are                   — `WelcomeDetails`
 *   3. Would you like the tour       — the sheet below, into `GuidedTour`
 *
 * Three sheets rather than one wizard, because they are three different KINDS of
 * question: the first has no neutral answer and cannot be dismissed, the second
 * and third do and must be. A wizard has one dismissal policy for all its steps.
 * `FirstRunChoice`'s header argues the first half of that.
 *
 * WHY IT WAITS. `store.tsx` renders this only once the fork is answered, so two
 * sheets are never on screen together — on a phone that matters more than on
 * the web, because a sheet is the whole bottom of the screen and a second one
 * behind it is simply invisible.
 *
 * THE ASYNC READ IS WHY THERE IS A `null` STATE. AsyncStorage cannot answer in
 * the first render. Defaulting to "not offered" would flash the details sheet at
 * every returning user for one frame; defaulting to "offered" would skip it for
 * genuinely new ones. So it renders nothing until the read lands, which is one
 * tick and no flicker either way.
 *
 * WHO SEES THE DETAILS STEP: anyone who has just come through the fork, and
 * anyone whose profile is genuinely blank. The first half is `fresh` and it is
 * load-bearing — the demo records seed a full profile, so a gate on `isBlank`
 * alone skipped the step for every user who chose them, which is most new
 * users. The second half catches a long-standing user who never filled theirs
 * in; they are asked once, which is a smaller cost than finding out inside a
 * cover letter that it prints `[YOUR NAME]`.
 */
export function Onboarding({ fresh }: { fresh: boolean }) {
  const c = useColors()
  const { isBlank } = useProfile()
  const [offered, setOffered] = useState<Record<OnboardingStage, boolean> | null>(null)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => {
    let live = true
    void readOffered().then((value) => {
      if (live) setOffered(value)
    })
    return () => {
      live = false
    }
  }, [])

  const finish = (stage: OnboardingStage) => {
    markOffered(stage)
    setOffered((prev) => (prev ? { ...prev, [stage]: true } : prev))
  }

  if (offered === null) return null

  if (!offered.details && (fresh || isBlank)) {
    // `fresh` is what makes the demo path work. Choosing the demo records seeds
    // a whole profile — 'Shaswata Mitra' and a stranger's links — so `isBlank` is
    // false and this step would skip itself for the newest user there is.
    return <WelcomeDetails fresh={fresh} onDone={() => finish('details')} />
  }

  /*
   * After the details and BEFORE the tour, matching the web flow. The tour
   * navigates away the moment it is accepted, so a question asked after it is a
   * question asked only of the people who said no to it.
   */
  if (!offered.reporting && REPORTING_ASKABLE) {
    return <ReportingStep onDone={() => finish('reporting')} />
  }

  if (!offered.tour) {
    // Once the tour is open the offer is answered, so the offer sheet is gone
    // and only the tour is on screen. Closing the tour ends onboarding.
    if (tourOpen) {
      return (
        <GuidedTour
          open
          onClose={() => {
            setTourOpen(false)
            finish('tour')
          }}
        />
      )
    }

    return (
      <Sheet
        open
        onClose={() => finish('tour')}
        title="Want the two-minute tour?"
        description="Six steps on what each part of the app is for — what the five tabs hold, how a deadline and an interview are one record, and where your data actually is."
        footer={
          <>
            <Button label="Not now" variant="ghost" size="md" onPress={() => finish('tour')} />
            <Button label="Start the tour" size="md" onPress={() => setTourOpen(true)} />
          </>
        }
      >
        <View style={{ gap: space[2], paddingBottom: space[2] }}>
          <View style={s.row}>
            <Feather name="compass" size={15} color={c.accent} />
            <Txt size="sm" tone="secondary">
              It changes nothing — no record is written and no setting is touched.
            </Txt>
          </View>
          <Txt size="xs" tone="muted">
            It is always there under More → How to use, so saying no now costs nothing.
          </Txt>
        </View>
      </Sheet>
    )
  }

  return null
}
