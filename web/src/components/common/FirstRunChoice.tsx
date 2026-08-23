import { useState } from 'react'
import { Sparkles, SquareDashed } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBoot } from '@/lib/boot-context'
import type { DataSetChoice } from '@/lib/data-set'

/**
 * The one decision jojo makes the user take, on the one launch where it is free.
 *
 * Until the store went to disk this question could not be asked. The demo
 * fixtures were recompiled into memory on every load, so "start fresh" was a
 * button that worked until you reloaded — and with nothing able to remember an
 * answer, asking for one would have been a dialog that came back every morning.
 * D24's meta row is what makes it answerable exactly once.
 *
 * WHY THIS IS NOT A CONFIRMATION
 *
 * It looks like one — a modal over the app with a destructive-sounding option in
 * it — and it is the opposite. A confirmation guards work the user authored, and
 * on a first run there is none: the records behind this scrim are fixtures they
 * have never seen before, minted ninety milliseconds ago by `boot()`. So there is
 * no danger tone, no *Cancel*, and no second dialog behind *Start empty*. The
 * app's delete law reserves a confirm for irreversible loss of authored work, and
 * ceremony spent where nothing is at stake is what teaches people to click
 * through the ceremony that matters. The two options are the same size and read
 * as a fork, because that is what they are.
 *
 * WHY IT CANNOT BE DISMISSED
 *
 * Escape and the backdrop are both stopped. The state this is preventing is not
 * "the user is undecided" — it is a user who pressed Escape, is looking at twelve
 * applications for Rice and Stripe that they did not create, and has no idea
 * whether jojo has just made them up or restored someone else's. There is no
 * neutral third answer to hand them: the store already holds one of the two sets,
 * so a dismissal would silently be a choice, made by the user's reflex rather
 * than their reading. Nothing here is destructive, so nothing is trapped behind
 * an unanswerable question — both buttons are one press and both are reversible
 * from Settings, which the copy says out loud.
 *
 * A reload IS still a way past it, and deliberately not fought. `boot()` wrote
 * the meta row in the same transaction as the seed (D24 — the seed and the
 * record of it cannot come apart), so a tab reloaded mid-question comes back as
 * a returning user holding the demo data: the app's behaviour before this dialog
 * existed, and the milder of the two outcomes to land on by accident. Blocking
 * that would mean a `beforeunload` prompt on a first visit, which is a worse
 * thing to do to a stranger than showing them a demo they can clear.
 *
 * The default is *Explore with demo data*: it is what is already on disk, so the
 * press that costs nothing is the one bound to the return key. A default that
 * emptied the store would make Enter — the key people press to make a dialog go
 * away — the destructive one.
 */

const OPTIONS: readonly {
  choice: DataSetChoice
  icon: typeof Sparkles
  title: string
  detail: string
  working: string
}[] = [
  {
    choice: 'demo',
    icon: Sparkles,
    title: 'Explore with demo data',
    detail:
      'A worked job search to look around in — twelve applications, a timeline, a stocked vault. Nothing in it is yours, and clearing it later takes one press.',
    working: 'Loading…',
  },
  {
    choice: 'empty',
    icon: SquareDashed,
    title: 'Start empty',
    detail:
      'No demo records at all. Every page opens on its empty state, and the first thing in jojo is something you added.',
    working: 'Clearing…',
  },
]

export function FirstRunChoice() {
  const { needsDataChoice, chooseDataSet, busy } = useBoot()
  /** Which button was pressed, so only that one says it is working. */
  const [pressed, setPressed] = useState<DataSetChoice | null>(null)

  // Unmounted rather than left open={false}, matching ConfirmDialog: a Radix
  // panel suspended mid-exit keeps `aria-hidden` and `pointer-events: none` on
  // the whole app shell behind it, and this one sits over a user's first ever
  // sight of jojo.
  if (!needsDataChoice) return null

  const choose = (choice: DataSetChoice) => {
    setPressed(choice)
    void chooseDataSet(choice).then((applied) => {
      // Only cleared on failure. On success this component unmounts in the same
      // commit, and resetting first would flash the idle label over a button
      // that is on its way out.
      if (!applied) setPressed(null)
    })
  }

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-xl"
        // Both halves of "no dismiss without choosing". Radix routes the
        // backdrop press, a press on the app behind it and a focus escape
        // through `onInteractOutside`; Escape has its own handler.
        onEscapeKeyDown={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>How would you like to start?</DialogTitle>
          <DialogDescription>
            jojo keeps everything on this machine, so this is yours to decide. Neither answer is
            final — you can load the demo data or clear every record later, from Settings.
          </DialogDescription>
        </DialogHeader>

        {/* One column on a phone, two from `sm`, and equal width in both: the
            options carry the same weight, and a fork drawn as a primary button
            beside a quiet one is a recommendation pretending to be a question. */}
        <div className="grid gap-2 sm:grid-cols-2">
          {OPTIONS.map(({ choice, icon: Icon, title, detail, working }) => (
            <button
              key={choice}
              type="button"
              onClick={() => choose(choice)}
              disabled={busy}
              className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-3 text-left transition-colors outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
            >
              <span className="flex items-center gap-2 text-sm font-medium">
                <Icon className="size-4 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
                {pressed === choice ? working : title}
              </span>
              <span className="text-xs text-text-2">{detail}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}
