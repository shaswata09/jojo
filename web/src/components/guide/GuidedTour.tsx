import { useCallback, useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { Compass } from 'lucide-react'
import { TourFooter } from '@/components/guide/tour/TourFooter'
import { clearProgress, readProgress, writeProgress } from '@/components/guide/tour/progress'
import { STEPS, type Handoff } from '@/components/guide/tour/steps'
import { Button } from '@/components/ui/button'
import { report } from '@/lib/analytics'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useDialogs } from '@/lib/dialogs-context'
import { cn } from '@/lib/utils'

/**
 * The guided tour.
 *
 * THE SHAPE, AND THE THREE SHAPES IT IS NOT.
 *
 * It is not a scripted click-through of a fake interface. That version has to
 * invent screens the app cannot produce — a scored scout match, a completed
 * transfer — and the reader finds out inside two minutes, at which point every
 * other sentence in the guide is suspect too. Everything else in this codebase
 * was built to avoid exactly that: the snapshot button that is disabled with
 * its reason on hover, the assistant reply that says it is canned, the transfer
 * page that says nothing was transmitted. A tutorial does not get an exemption.
 *
 * It is not a coach-mark overlay walking across the app either, though that was
 * the first design. To survive a route change an overlay has to be mounted
 * above the router, and the only mount points above the router belong to the
 * app shell — which this package does not own. What is here is the same
 * contract in a shape that fits: point, explain, hand over to the real control,
 * and keep the reader's place so the handover is not a dead end.
 *
 * And it is not a second copy of the reference pages. Every step is about where
 * a thing IS and what it will do when you press it, which is the part a written
 * page is worst at — six of the thirteen routes are not in the sidebar at all.
 *
 * THE RULE THAT MAKES IT HONEST: it never types, never submits and never
 * writes. A tour that filled in a form and saved it would author a record the
 * reader did not author, and in this app that record is then visible in three
 * places — the list, the undo stack and the audit log — as something they did
 * not do. Every step ends with the real control in front of them, untouched.
 *
 * THE DELIBERATE OMISSION: no step on scout matches, the assistant or transfer.
 * Those three screens are honest about themselves in place, and walking a
 * first-time reader through them as though they were finished features is the
 * same lie the fake click-through tells, only slower. They are covered on the
 * reference page, where the reader arrives already knowing what to expect.
 *
 * What each step SAYS is in `tour/steps`; the bookmark is in `tour/progress`;
 * the footer and its focus rules are in `tour/TourFooter`. This file is the
 * launcher, the dialog around them and the hand-off.
 */

/**
 * The tour, and the button that opens it.
 *
 * One component rather than a launcher plus a separately mounted overlay: the
 * dialog belongs to the button that summoned it, and splitting them would mean
 * a page could mount one without the other. It must be rendered inside the
 * router — every hand-off is a real link — which any guide page is.
 */
/**
 * Router state that means "the reader already asked for the tour, open it".
 *
 * Onboarding's button says START THE TOUR and, until this, navigated to the
 * page the launcher lives on and stopped — leaving a second button, differently
 * worded, between the reader and the thing they had just asked for. Sending an
 * intent along with the navigation is what closes that gap; a query parameter
 * would have done it too, but it would also have survived being bookmarked,
 * shared and reloaded, and a tour that reopens every time you return to the
 * page you saved is worse than one you have to click twice.
 */
export type TourIntent = { startTour?: boolean }

export function TourLauncher({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState(() => readProgress(STEPS.length))
  const { open: openDialog } = useDialogs()
  const location = useLocation()
  const navigate = useNavigate()

  /*
   * Opened once per arrival, and the state is consumed as it is read.
   *
   * `replace` rather than push, so the history entry the reader came from stays
   * where it was — and so that going BACK to this page later, or reloading it,
   * does not find the intent still sitting there and reopen a tour nobody asked
   * for the second time.
   */
  const asked = (location.state as TourIntent | null)?.startTour === true
  useEffect(() => {
    if (!asked) return
    setOpen(true)
    report('tour_used', { outcome: 'started' })
    void navigate(location.pathname, { replace: true, state: null })
  }, [asked, location.pathname, navigate])

  /**
   * What to do once this dialog has finished closing.
   *
   * The app mounts one dialog at a time and asking for a second replaces the
   * first, so a hand-off cannot simply call `open('timelineItem')` while the
   * tour is still up — the two would fight over the focus scope, and the loser
   * leaves focus on a node that has been removed. Radix fires
   * `onCloseAutoFocus` when the tour is on its way out, which is exactly the
   * moment the next dialog may take over.
   */
  const pending = useRef<(() => void) | null>(null)

  /** The scroll container, which is the dialog itself — see its className. */
  const contentRef = useRef<HTMLDivElement>(null)

  const total = STEPS.length
  const current = STEPS[step] ?? STEPS[0]
  const isLast = step === total - 1

  const remember = useCallback((next: number) => {
    setStep(next)
    writeProgress(next)
  }, [])

  const go = useCallback(
    (delta: number) => {
      const next = Math.min(Math.max(step + delta, 0), total - 1)
      if (next !== step) remember(next)
    },
    [step, total, remember],
  )

  const restart = useCallback(() => remember(0), [remember])

  /**
   * Finishing clears the bookmark rather than parking on the last step.
   *
   * Otherwise the button reads "Resume — step 7 of 7" forever, and pressing it
   * reopens the ending. Clearing means the next press starts at the beginning,
   * which is what "take the tour again" has to mean.
   */
  const finish = useCallback(() => {
    clearProgress()
    setStep(0)
    setOpen(false)
    // The other half of the pair below. `started` vs `finished` is the whole
    // question the tour raises — people opening it and not reaching the end is
    // the failure worth knowing about, and one count without the other cannot
    // show it.
    report('tour_used', { outcome: 'finished' })
  }, [])

  /**
   * A hand-off advances first, then leaves.
   *
   * The step being handed off is done — the reader is about to go and do it —
   * so resuming should land on the next one. Getting this backwards produces a
   * tour that offers the same page every time it is reopened.
   */
  const handOff = useCallback(
    (handoff: Handoff) => {
      if (!isLast) remember(step + 1)
      else clearProgress()
      if (handoff.kind === 'dialog') {
        pending.current = () => openDialog(handoff.name, handoff.props)
      }
      setOpen(false)
    },
    [isLast, remember, step, openDialog],
  )

  // Left and right walk the tour, the way they walk any stepped surface. No
  // guard for typing targets is needed — there is no field in here — but a
  // modifier means the browser's own shortcut and must be left alone.
  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.key === 'ArrowRight' && !isLast) {
        event.preventDefault()
        go(1)
      }
      if (event.key === 'ArrowLeft' && step > 0) {
        event.preventDefault()
        go(-1)
      }
    },
    [go, isLast, step],
  )

  /**
   * Each step starts at its own beginning.
   *
   * The dialog is the scroll container, and scroll position belongs to the
   * element rather than to what is inside it — so a reader who scrolled to the
   * foot of a long step and pressed Next landed on the next one already partway
   * down, having apparently skipped its opening paragraph. Remounting the body
   * does not fix that; only moving the container does.
   */
  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [step])

  const started = step > 0

  return (
    <>
      <Button
        variant="outline"
        className={cn('gap-1.5', className)}
        onClick={() => {
          setOpen(true)
          report('tour_used', { outcome: 'started' })
        }}
        aria-haspopup="dialog"
      >
        <Compass aria-hidden />
        {started ? `Resume the tour — step ${step + 1} of ${total}` : 'Take the tour'}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          /* Capped and scrollable, the way ToolRunDialog is. A dialog is
             centred on the viewport with no height limit of its own, so the
             longest step here — six stage chips and three paragraphs — ran off
             both ends of a 390×700 phone, taking Next with it and leaving
             Escape as the only way out of a tutorial. */
          className="max-h-[85dvh] overflow-y-auto sm:max-w-xl"
          ref={contentRef}
          onKeyDown={onKeyDown}
          onCloseAutoFocus={(event) => {
            const run = pending.current
            if (!run) return
            pending.current = null
            // Let the next dialog claim focus instead of handing it back to the
            // button that opened this one, which would put the reader outside
            // the thing they just asked for.
            event.preventDefault()
            run()
          }}
        >
          <DialogHeader>
            <DialogTitle>{current.title}</DialogTitle>
            <DialogDescription>{current.lede}</DialogDescription>
          </DialogHeader>

          {/* The title only announces on open, so the step change has to be
              announced separately — otherwise Next is silent to a screen
              reader and the reader has no idea anything happened. */}
          <p aria-live="polite" className="sr-only">
            {`Step ${step + 1} of ${total}: ${current.title}`}
          </p>

          <div key={current.id} className="text-sm text-text-2">
            {current.body}
          </div>

          {/* Bound to a local so the narrowing survives into the callbacks —
              `current.handoff` is a property read and TypeScript re-widens it
              inside a closure, which is what the non-null assertions here were
              papering over. */}
          {(() => {
            const handoff = current.handoff
            if (!handoff) return null
            return (
              <div className="rounded-lg border border-hairline bg-well p-3">
                {handoff.kind === 'route' ? (
                  <Button variant="secondary" size="sm" asChild>
                    <Link to={handoff.to} onClick={() => handOff(handoff)}>
                      {handoff.label}
                    </Link>
                  </Button>
                ) : (
                  <Button variant="secondary" size="sm" onClick={() => handOff(handoff)}>
                    {handoff.label}
                  </Button>
                )}
                {/* What the button will do, before it is pressed. A tour that
                    navigates without warning reads as having lost the reader's
                    place rather than as having handed over. */}
                <p className="mt-2 text-xs text-text-3">{handoff.note}</p>
              </div>
            )
          })()}

          <TourFooter
            step={step}
            total={total}
            isLast={isLast}
            onGo={go}
            onRestart={restart}
            onFinish={finish}
          />
        </DialogContent>
      </Dialog>
    </>
  )
}
