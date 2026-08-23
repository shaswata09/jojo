import { useState } from 'react'
import { Compass } from 'lucide-react'
import { useProfile } from '@jojo/service/react/use-profile'
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
 * load-bearing — the demo records seed a full profile, 'Alex Rahman' and all,
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
  const [tourOffered, setTourOffered] = useState(() => wasOffered('tour'))

  const finish = (stage: 'details' | 'tour') => {
    markOffered(stage)
    if (stage === 'details') setDetailsOffered(true)
    else setTourOffered(true)
  }

  // The fork owns the screen until it is answered.
  if (needsDataChoice) return null

  if (!detailsOffered && (fresh || isBlank)) {
    return <WelcomeDetails open fresh={fresh} onDone={() => finish('details')} />
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
            {/* A link rather than a router push: the tour lives on the guide's
                overview page and opens itself from the launcher there, so the
                honest handover is to send the reader to where it is. */}
            <Button asChild>
              <a href={guidePath('overview')} onClick={() => finish('tour')}>
                Start the tour
              </a>
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
