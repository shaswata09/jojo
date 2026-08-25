import { useState } from 'react'
import { Link } from 'react-router'
import { Compass } from 'lucide-react'
import { useProfile } from '@jojo/service/react/use-profile'
import {
  ConnectModelStep,
  CrashStep,
  DocumentReaderStep,
  ExtensionStep,
} from '@/components/common/SetupSteps'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { CRASH_CAPABILITY } from '@/lib/crash-log'
import { ANALYTICS_CAPABILITY } from '@/lib/analytics'
import { WelcomeDetails } from '@/components/common/WelcomeDetails'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBoot } from '@/lib/boot-context'
import { markOffered, wasOffered } from '@/lib/onboarding'
import type { OnboardingStage } from '@/lib/onboarding'
import { guidePath } from '@/lib/links'

/**
 * The first minute, as three questions in order.
 *
 *   1. Which records to start from   — `FirstRunChoice`, mounted beside this
 *   2. Who you are                   — `WelcomeDetails`
 *   3. Would you like the tour       — the panel below
 *
 * They are three dialogs rather than one wizard because they are three
 * different KINDS of question, and the middle one is the reason: the first has
 * no neutral answer and cannot be dismissed, the second and third do and must
 * be. A wizard has one dismissal policy for all its steps, so putting these in
 * one would mean either trapping someone on a form they are allowed to skip or
 * letting Escape silently pick a data set. `FirstRunChoice`'s header argues the
 * first half of that at length.
 *
 * WHY IT WAITS FOR THE FORK. `needsDataChoice` is true while that dialog is
 * open, and stacking a second modal behind it would put two focus traps on
 * screen with the reader able to reach neither reliably. So this renders
 * nothing until the fork has been answered, which for a returning user is
 * immediately.
 *
 * WHO SEES THE DETAILS STEP: anyone who has just come through the fork, and
 * anyone whose profile is genuinely blank. The first half is `fresh` and it is
 * load-bearing — the demo records seed a full profile, 'Shaswata Mitra' and all,
 * so a gate on `isBlank` alone skipped the step for every user who chose them,
 * which is most new users. The second half catches a long-standing user who
 * never filled theirs in. The flags in `lib/onboarding.ts` record only that we
 * ASKED, so skipping is respected.
 *
 * A LONG-STANDING USER WITH A BLANK PROFILE will see the details step once. That
 * is deliberate rather than an accident of the gate: the profile being blank is
 * exactly the state that makes drafts print `[YOUR NAME]`, and one dismissable
 * prompt is a smaller cost than finding that out inside a cover letter.
 */
export function Onboarding() {
  const { needsDataChoice } = useBoot()
  const { isBlank } = useProfile()
  const { settings } = useModelSettings()

  /*
   * Whether the fork was answered in THIS session.
   *
   * `needsDataChoice` cannot answer it: it is false for a returning user and
   * false again the instant the fork closes, so by the time this renders the
   * two cases are indistinguishable. Latching it on the transition is what
   * separates them — and it matters because the demo records seed a whole
   * profile, so a gate on `isBlank` alone skips the details step for exactly
   * the new user it exists for.
   */
  const [sawFork, setSawFork] = useState(false)
  const [fresh, setFresh] = useState(false)
  if (needsDataChoice && !sawFork) setSawFork(true)
  if (!needsDataChoice && sawFork && !fresh) setFresh(true)

  // Read once, on mount, and never again. These are localStorage reads, and
  // re-reading them per render would make the sequence flicker as it writes:
  // marking `details` offered would immediately re-evaluate and could unmount
  // the dialog mid-transition. State advances the sequence; storage only
  // remembers it for the next launch.
  const [detailsOffered, setDetailsOffered] = useState(() => wasOffered('details'))
  const [modelOffered, setModelOffered] = useState(() => wasOffered('model'))
  const [readerOffered, setReaderOffered] = useState(() => wasOffered('reader'))
  const [extensionOffered, setExtensionOffered] = useState(() => wasOffered('extension'))
  const [crashOffered, setCrashOffered] = useState(() => wasOffered('crash'))
  const [tourOffered, setTourOffered] = useState(() => wasOffered('tour'))

  const ADVANCE: Record<OnboardingStage, (v: boolean) => void> = {
    details: setDetailsOffered,
    model: setModelOffered,
    reader: setReaderOffered,
    extension: setExtensionOffered,
    crash: setCrashOffered,
    tour: setTourOffered,
  }

  const finish = (stage: OnboardingStage) => {
    markOffered(stage)
    ADVANCE[stage](true)
  }

  // The fork owns the screen until it is answered.
  if (needsDataChoice) return null

  if (!detailsOffered && (fresh || isBlank)) {
    return <WelcomeDetails open fresh={fresh} onDone={() => finish('details')} />
  }

  /*
   * Three setup offers, between saying who you are and being shown around.
   *
   * Here rather than after the tour because the tour describes an app that can
   * do things, and walking someone through the assistant before they have a
   * model connected shows them the scripted stand-in.
   */
  if (!modelOffered) {
    return <ConnectModelStep onSkip={() => finish('model')} onDone={() => finish('model')} />
  }

  /*
   * The reader is offered ONLY with a model connected, and skipped silently
   * otherwise. On its own it does nothing a person can see — it is the thing
   * the AGENT reads documents through — so asking someone who has just declined
   * a model to install a Python service would be asking them to set up a
   * dependency of something they said no to.
   *
   * Not marked as offered when it is skipped this way: `wasOffered` records
   * that we ASKED, and we did not. Someone who connects a model next week gets
   * the question then, which is exactly when it starts being worth answering.
   */
  /*
   * THE EXTENSION COMES BEFORE THE READER, and the order is a dependency rather
   * than a preference.
   *
   * markitdown-mcp sends no CORS headers, so a page cannot call it across ports;
   * the dev server proxies that away, and a hosted copy has no proxy. The
   * extension is what carries the request. So asking somebody to set up and TEST
   * a reader before they have the thing that can reach it is asking them to
   * watch it fail — and the failure is indistinguishable, on screen, from a
   * reader they installed wrongly.
   *
   * It is still independent of the model: keeping a posting is worth doing on
   * its own, which is why it is not gated on `isConfigured` the way the reader
   * is.
   */
  if (!extensionOffered) {
    return <ExtensionStep onSkip={() => finish('extension')} onDone={() => finish('extension')} />
  }

  if (!readerOffered && isConfigured(settings)) {
    return <DocumentReaderStep onSkip={() => finish('reader')} onDone={() => finish('reader')} />
  }

  /*
   * LAST OF THE SETUP STEPS, and immediately before the tour rather than after
   * it — the tour navigates away the moment it is accepted, so a question asked
   * after it is a question asked of somebody who has already left.
   *
   * `CrashStep` renders nothing when the build has reporting compiled out, so
   * this advances rather than showing an empty dialog.
   *
   * BOTH capabilities are tested, not just the crash one. Testing only
   * CRASH_CAPABILITY skipped the whole consent step in a build that had
   * VITE_ANALYTICS set and VITE_CRASH_REPORTING unset — and analytics defaults
   * to on, so that build reported usage to Google having asked nobody. The
   * phone's `REPORTING_ASKABLE` is the same test, spelled the same way.
   */
  if (!crashOffered) {
    if (CRASH_CAPABILITY === 'off' && ANALYTICS_CAPABILITY === 'off') {
      finish('crash')
      return null
    }
    return <CrashStep onSkip={() => finish('crash')} onDone={() => finish('crash')} />
  }

  if (!tourOffered) {
    return (
      <Dialog
        open
        onOpenChange={(next) => {
          if (!next) finish('tour')
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Compass className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
              Want the two-minute tour?
            </DialogTitle>
            <DialogDescription>
              Seven steps on what each part of the app is for — where a record lives, how a deadline
              and an interview are the same kind of thing, and where your data actually is. It hands
              you to the real controls rather than showing pictures of them, and it keeps your place
              if you wander off.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter>
            <Button variant="ghost" onClick={() => finish('tour')}>
              Not now
            </Button>
            {/* A router Link, not a bare anchor.
                The handover is still the same one the old comment argued for —
                the tour lives on the guide's overview page and opens itself
                from the launcher there, so the honest thing is to send the
                reader where it is. What a bare `<a>` also did was leave the
                router: it bypassed `basename`, so on GitHub Pages — served at
                `/<repo>/` — "Start the tour" went to `github.io/guide` instead
                of `github.io/jojo/guide` and landed on a 404.

                It also reloaded the document, which now costs more than it did:
                agent runs live in a registry above the router (`agent-runs.ts`)
                and a reload is the one thing that genuinely kills them. Anyone
                who pressed this mid-conversation lost it. */}
            <Button asChild>
              <Link to={guidePath('overview')} onClick={() => finish('tour')}>
                Start the tour
              </Link>
            </Button>
          </DialogFooter>

          <p className="text-xs text-text-3">
            It is always there under <span className="text-text-1">How to use</span>, so saying no
            now costs nothing.
          </p>
        </DialogContent>
      </Dialog>
    )
  }

  return null
}
