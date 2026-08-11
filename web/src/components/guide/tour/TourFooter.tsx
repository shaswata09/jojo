import { useRef } from 'react'
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'

/**
 * THE FOOTER, AND THE ONE BUG IT KEEPS TRYING TO HAVE.
 *
 * A control that disables or unmounts ITSELF as a result of its own click drops
 * focus on the floor: the browser blurs a disabled element, React discards a
 * removed one, and either way `document.activeElement` becomes <body> — inside
 * a focus-trapped dialog, where the next Tab starts from the top again. Three
 * controls here can do it (Back at step 1, Start over, and Next when it becomes
 * Finish), so all three are handled rather than rediscovered one at a time.
 *
 * All three cures need the same node to hand focus to, so the ref that names it
 * and every control that can drop focus live in this one file. Splitting them
 * across the dialog would put a fix in one file and the thing it fixes in
 * another, which is how this bug got shipped twice.
 */
export function TourFooter({
  step,
  total,
  isLast,
  onGo,
  onRestart,
  onFinish,
}: {
  step: number
  total: number
  isLast: boolean
  /** Walk by a signed number of steps, clamped by the caller. */
  onGo: (delta: number) => void
  /** Back to step 0, keeping the bookmark. */
  onRestart: () => void
  /** Clears the bookmark and closes — see `TourLauncher`. */
  onFinish: () => void
}) {
  /**
   * The Next/Finish button — the footer's landing place for focus.
   *
   * It is the one control that is present and enabled at every step, which is
   * what makes it the right thing to hand focus to when another control is
   * about to disable itself. See the three cases below.
   */
  const advanceRef = useRef<HTMLButtonElement>(null)

  const started = step > 0

  return (
    <DialogFooter className="items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <p className="tabular text-xs text-text-3">
          Step {step + 1} of {total}
        </p>
        {/* Rendered at every step and disabled at the first, rather than
            appearing and disappearing — a control that comes and goes under
            the pointer is worse than one that greys out. */}
        <Button
          variant="ghost"
          size="xs"
          disabled={!started}
          onClick={() => {
            advanceRef.current?.focus()
            onRestart()
          }}
          className="gap-1 text-text-3"
        >
          <RotateCcw aria-hidden />
          Start over
        </Button>
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            // Focus moves BEFORE the state change, while this button is still
            // enabled and the target still exists. Doing it after would need a
            // layout effect to find a node React has not rendered yet.
            if (step === 1) advanceRef.current?.focus()
            onGo(-1)
          }}
          disabled={step === 0}
          className="gap-1"
        >
          <ArrowLeft aria-hidden />
          Back
        </Button>
        {/* One button, not two. Next and Finish as separate elements swapped
            one DOM node for another on the last step, and the keyboard user who
            pressed Next to get there was left with nothing focused. Same node,
            different label and handler. */}
        <Button
          ref={advanceRef}
          size="sm"
          onClick={isLast ? onFinish : () => onGo(1)}
          className="gap-1"
        >
          {isLast ? 'Finish' : 'Next'}
          {isLast ? null : <ArrowRight aria-hidden />}
        </Button>
      </div>
    </DialogFooter>
  )
}
