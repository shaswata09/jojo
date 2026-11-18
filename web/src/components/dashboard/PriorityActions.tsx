import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { CalendarClock, Check, ChevronLeft, ChevronRight, CircleCheckBig } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { SnoozeSteps } from '@/components/common/SnoozeSteps'
import { revealFocused } from '@/components/common/reveal-focus'
import { checklistClosed, checklistOpened, closeChecklist, openChecklist } from '@/lib/onboarding'
import { snoozeAnchor } from '@/components/common/snooze'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addDays } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath } from '@/lib/links'
import { chronological, usePriorityActions, type PriorityAction } from '@/lib/priority'
import { MARK_TEXT } from '@/lib/timeline-visuals'
import type { DateMark } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'
import { announceRefusal } from '@/components/common/write-result'
import { useMascot } from '@/lib/mascot-context'
import { CUES } from '@/lib/mascot-cues'
import { useDomain } from '@/i18n/domain'

/**
 * The card's only colour, and it comes off the date.
 *
 * red = past due, amber = due inside 48 hours. Anything further out is neutral
 * — the deck used to paint a 34-day offer green, which read as "you are fine"
 * on the one card that ends every other application you are running.
 */
const URGENCY_BORDER: Record<DateMark, string> = {
  overdue: 'border-danger-border',
  soon: 'border-warning-border',
  none: 'border-hairline',
}

/**
 * Done and Snooze for a card that has a dated item behind it.
 *
 * Both write straight to the timeline, so the card recomputes and usually
 * leaves the deck — which is why each one raises an undo. A card whose item is
 * missing (an offer) renders neither rather than showing two controls with
 * nothing to write to.
 */
/**
 * The timeline's writers, read ONCE by the deck and handed to every card.
 *
 * Each card used to call `useTimeline()` itself, and every instance rebuilds
 * its own index and five filters over the whole timeline — so one commit cost
 * cards × items, measured at 1.6s for a single tick on a large store.
 */
type DeckTimeline = Pick<
  ReturnType<typeof useTimeline>,
  'get' | 'toggleDone' | 'update' | 'snooze' | 'reschedule'
>

function ItemControls({
  itemId,
  timeline,
  size = 'sm',
}: {
  itemId: string
  timeline: DeckTimeline
  size?: 'sm' | 'xs'
}) {
  const { t } = useTranslation('dashboard')
  const domain = useDomain()
  const { get, toggleDone, update, snooze, reschedule } = timeline
  const { toast } = useToast()
  const mascot = useMascot()
  const [open, setOpen] = useState(false)
  const item = get(itemId)
  if (!item) return null

  // The store counts from today only for an overdue item, and the toast below
  // has to name the same day the write lands on.
  const anchor = snoozeAnchor(item.date)

  const done = () => {
    if (announceRefusal(toggleDone(item.id), toast)) return
    mascot.play(CUES.taskDone)
    toast({
      title: t('common.completed', { title: item.title }),
      description: t('priority.completedDescription'),
      // Not a second toggleDone: by the time this is pressed the item may have
      // been unticked elsewhere, and toggling again would re-tick it.
      action: { label: t('common.undo'), onClick: () => update(item.id, { completedOn: null }) },
    })
  }

  const push = (days: number) => {
    const before = item.date
    setOpen(false)
    if (announceRefusal(snooze(item.id, days), toast)) return
    toast({
      title: t('common.rescheduled', { title: item.title }),
      description: t('priority.rescheduledDescription', {
        date: domain.shortDate(addDays(anchor, days)),
      }),
      action: { label: t('common.undo'), onClick: () => reschedule(item.id, before) },
    })
  }

  return (
    <>
      <Button
        variant="ghost"
        size={size}
        title={t('priority.tickOff', { title: item.title })}
        onClick={done}
      >
        <Check className="size-3.5" strokeWidth={2} aria-hidden />
        {t('priority.done')}
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size={size} title={t('common.pushOut', { title: item.title })}>
            <CalendarClock className="size-3.5" strokeWidth={1.8} aria-hidden />
            {t('priority.snooze')}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-48 gap-1 p-1.5">
          <div className="px-1 pb-0.5 text-xs tracking-wide text-text-3 uppercase">
            {t('common.pushOutBy')}
          </div>
          <SnoozeSteps date={item.date} spell="duration" onPick={push} />
        </PopoverContent>
      </Popover>
    </>
  )
}

function ActionButton({ action }: { action: PriorityAction['actions'][number] }) {
  const { t } = useTranslation('dashboard')
  const { open } = useDialogs()

  if (action.to) {
    return (
      <Button variant={action.primary ? 'default' : 'ghost'} size="sm" asChild>
        <Link to={action.to}>{action.label}</Link>
      </Button>
    )
  }

  return (
    <Button
      size="sm"
      variant={action.primary ? 'default' : 'ghost'}
      // An action is a destination, a dialog, or a stated blocker. Anything
      // added without one of the first two greys out with the reason on it
      // rather than shipping as a button that swallows the click.
      disabled={!action.draft}
      title={action.blocker ?? (action.draft ? undefined : t('priority.notConnected'))}
      onClick={action.draft ? () => open('draft', action.draft) : undefined}
    >
      {action.label}
    </Button>
  )
}

/**
 * One decision, as a card on the timeline.
 *
 * The headline is the instruction ("Reply to Baylor"), the date is stated once,
 * and the thing that moves the decision along is the filled button. No
 * background of its own — a second surface inside a panel reads as a hole —
 * so the border carries the deck's one permitted colour: red past due, amber
 * inside 48 hours, neutral beyond.
 *
 * Every card has the same shape now. The deck used to give its first card the
 * full treatment and the rest one line each, which was right for a list read
 * top-down by importance and wrong for one laid out along time, where no card
 * is "first" except by date.
 */
function DecisionCard({ action, timeline }: { action: PriorityAction; timeline: DeckTimeline }) {
  return (
    <div
      className={cn(
        'flex h-full flex-col rounded-md border px-3.5 py-3',
        URGENCY_BORDER[action.urgency],
      )}
    >
      <Chip tone="gray" size="sm" className="self-start">
        {action.kindLabel}
      </Chip>

      <h3 className="mt-2 line-clamp-2 text-base font-semibold">{action.headline}</h3>
      <p className="mt-1 line-clamp-2 text-sm text-text-2">{action.context}</p>
      <p className={cn('mt-1.5 text-xs', MARK_TEXT[action.urgency])}>{action.timing}</p>

      {/* Pinned to the bottom, so cards of different lengths line their
          buttons up along the track. */}
      <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-3">
        {action.actions.map((a) => (
          <ActionButton key={a.label} action={a} />
        ))}
        {/* Done and Snooze come last: they end the card, and putting them first
            would put "dismiss this" ahead of "deal with it". */}
        {action.itemId ? <ItemControls itemId={action.itemId} timeline={timeline} /> : null}
      </div>
    </div>
  )
}

/**
 * How many cards the deck renders before a "Show all" stop at the end of the
 * track — `OwedThisWeek`'s OVERDUE_SHOWN, for the same reason: the deck had no
 * cap, one card per overdue application or offer, and a large store mounted a
 * thousand of them on the page the app opens on.
 */
const DECK_SHOWN = 20

/** Keyboard focus on a card off the track's edge snaps the whole card in. */
const revealCard = revealFocused('li')

/** How much of the track a step moves when there is no card to measure. */
const FALLBACK_STEP = 0.8

/**
 * The deck as a timeline: earliest on the left, the furthest out on the right.
 *
 * A carousel was tried here once and taken out, and the three reasons are
 * written down so this one does not repeat them:
 *
 * - Cards were reachable only by pressing an arrow. This track is a native
 *   horizontal scroller — swipe, trackpad, Shift-wheel and the keyboard all
 *   move it — and the arrows are a shortcut on top, not the only way in.
 * - Off-screen cards stayed in the tab order. They still do, deliberately,
 *   because every card is a real decision; what changed is that focusing one
 *   scrolls its whole card into view (`revealCard`, below), so focus never
 *   lands somewhere invisible. The browser does not do that by itself: it
 *   leaves a scroller alone while the focused control is even partly
 *   visible, and the second card's buttons were focused at 28% visible with
 *   the track unmoved (finding a11y-5).
 * - The track was an `aria-live` region that re-announced a whole card on
 *   every scroll tick. Nothing here announces anything: it is a labelled list
 *   in date order, read like any other list.
 *
 * Opens scrolled to the start, which is the oldest card — so whatever is most
 * overdue is what you see first, and the later ones are a swipe away.
 */
function DecisionTimeline({ actions, hint }: { actions: PriorityAction[]; hint: string }) {
  const { t } = useTranslation('dashboard')
  const { get, toggleDone, update, snooze, reschedule } = useTimeline()
  const timeline = useMemo<DeckTimeline>(
    () => ({ get, toggleDone, update, snooze, reschedule }),
    [get, toggleDone, update, snooze, reschedule],
  )
  const [showAll, setShowAll] = useState(false)
  const capped = actions.length > DECK_SHOWN
  const shown = capped && !showAll ? actions.slice(0, DECK_SHOWN) : actions
  const track = useRef<HTMLUListElement>(null)
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)')
  /** Whether there is more to scroll to on each side, and which way the track runs. */
  const [more, setMore] = useState({ before: false, after: false, rtl: false })

  const measure = useCallback(() => {
    const el = track.current
    if (!el) return
    // Right to left, `scrollLeft` starts at 0 and runs NEGATIVE towards the
    // end, so the distance travelled is its magnitude. Read as LTR, Earlier
    // never lit and Later scrolled past the start and did nothing.
    const rtl = getComputedStyle(el).direction === 'rtl'
    const travelled = Math.abs(el.scrollLeft)
    // A pixel of slack: subpixel layouts stop a pixel short of the end.
    setMore({
      before: travelled > 1,
      after: travelled + el.clientWidth < el.scrollWidth - 1,
      rtl,
    })
  }, [])

  useEffect(() => {
    measure()
    const el = track.current
    if (!el) return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [measure, shown.length])

  /** One card's width per press, so a step always lands on a card edge. */
  const step = (direction: -1 | 1) => {
    const el = track.current
    if (!el) return
    const first = el.firstElementChild
    const gap = Number.parseFloat(getComputedStyle(el).columnGap) || 0
    const by = first ? first.getBoundingClientRect().width + gap : el.clientWidth * FALLBACK_STEP
    // Later is leftward on a right-to-left page.
    const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1
    el.scrollBy({ left: sign * direction * by, behavior: reduced ? 'auto' : 'smooth' })
  }

  const overflows = more.before || more.after
  // A soft fade on whichever side has more, so a cut-off card reads as "keeps
  // going" rather than as a layout bug. Masked rather than overlaid, so nothing
  // sits on top of the cards' buttons.
  // The gradients run start to end, which is leftward right to left.
  const fade = 'transparent 0, black 1.5rem, black calc(100% - 1.5rem), transparent 100%'
  const toEnd = more.rtl ? 'to left' : 'to right'
  const toStart = more.rtl ? 'to right' : 'to left'
  const mask =
    more.before && more.after
      ? `linear-gradient(${toEnd}, ${fade})`
      : more.after
        ? `linear-gradient(${toEnd}, black calc(100% - 1.5rem), transparent 100%)`
        : more.before
          ? `linear-gradient(${toStart}, black calc(100% - 1.5rem), transparent 100%)`
          : undefined

  return (
    <>
      <PanelTitle
        hint={hint}
        right={
          overflows ? (
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('priority.earlierAria')}
                title={t('priority.earlier')}
                disabled={!more.before}
                onClick={() => step(-1)}
              >
                <ChevronLeft className="size-4 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-8"
                aria-label={t('priority.laterAria')}
                title={t('priority.later')}
                disabled={!more.after}
                onClick={() => step(1)}
              >
                <ChevronRight className="size-4 rtl:-scale-x-100" strokeWidth={1.8} aria-hidden />
              </Button>
            </div>
          ) : undefined
        }
      >
        {t('priority.title')}
      </PanelTitle>

      <ul
        ref={track}
        aria-label={t('priority.listLabel')}
        onScroll={measure}
        onFocus={revealCard}
        /*
         * Bled out to the panel's edges, `PanelScroll`'s treatment: the negative
         * margins cancel the panel's padding and the same padding goes straight
         * back on the inside, so the cards stay where they were and only the
         * scrollbar moves — onto the panel's bottom edge instead of floating
         * above it. It used to bleed 4px sideways and not at all downwards.
         *
         * `flex-1` (the panel is a flex column) because the dashboard grid
         * stretches this panel to match "At a glance" beside it — 434px against
         * ~260px of content at 1100px wide, measured — so cancelling the padding
         * alone left the bar 117px short of the bottom. Filling the panel puts
         * it on the edge at every width. The cards stretch with it, which is
         * what `DecisionCard` is built for: `h-full`, actions pinned `mt-auto`.
         *
         * `scroll-px-*` matches the padding so snapping counts it — without it
         * the first card snapped in by the padding, the track opened
         * "scrolled", with the Earlier arrow lit and the first card's edge
         * faded. The padding also keeps focus rings from being clipped.
         */
        className="-mx-4 -mb-4 flex min-h-0 flex-1 snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto overscroll-x-contain px-4 pb-4 sm:-mx-5 sm:-mb-5 sm:scroll-px-5 sm:px-5 sm:pb-5"
        style={mask === undefined ? undefined : { maskImage: mask, WebkitMaskImage: mask }}
      >
        {shown.map((action) => (
          <li key={action.id} className="w-[min(20rem,85%)] shrink-0 snap-start">
            <DecisionCard action={action} timeline={timeline} />
          </li>
        ))}
        {capped ? (
          // The last stop on the track, in date order like everything before it.
          <li className="grid shrink-0 snap-start place-items-center px-2">
            <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
              {showAll ? t('owed.showFewer') : t('owed.showAll', { total: actions.length })}
            </Button>
          </li>
        ) : null}
      </ul>
    </>
  )
}

/**
 * The three conditions the checklist reads, lifted out so the gate that keeps
 * the checklist on screen and the checklist itself cannot disagree about what
 * "done" means.
 */
function useFirstStepsProgress() {
  const { all } = useApplications()
  const { all: items, reminders } = useTimeline()

  return useMemo(
    () => ({
      application: all.length > 0,
      // A dated record that is not a reminder — step 3 owns the reminders.
      dated: items.some((i) => !i.remind),
      reminder: reminders.length > 0,
    }),
    [all, items, reminders],
  )
}

type FirstStepsProgress = ReturnType<typeof useFirstStepsProgress>

/**
 * The three steps that turn an empty install into a working one.
 *
 * Shown in place of the deck while the install is bare, because a deck that
 * computes "nothing needs deciding" from zero records is technically true and
 * useless on the one screen a new user lands on. Each `done` is read off the
 * store, never remembered separately — a checklist with its own memory goes on
 * claiming you added something after you deleted it.
 *
 * Step 1 used to be the literal `false`, so the one step that could never tick
 * sat above two that could, under a sentence promising all three would. It now
 * reads the applications the same way the others read their records.
 *
 * These three mirror the first three steps of the Guide's Getting-started list.
 * They are written out again rather than imported because that list lives in
 * `routes/Guide.tsx`, which this package does not own; if the two ever need to
 * stay in step, lifting `StepList` into `components/common/` is the fix.
 */
function FirstSteps({ progress, onClose }: { progress: FirstStepsProgress; onClose: () => void }) {
  const { t } = useTranslation('dashboard')
  const { open } = useDialogs()

  const steps = [
    {
      id: 'application',
      title: t('firstSteps.application.title'),
      body: t('firstSteps.application.body'),
      done: progress.application,
      onClick: () => open('application'),
      label: t('common.newApplication'),
    },
    {
      id: 'dated',
      title: t('firstSteps.dated.title'),
      body: t('firstSteps.dated.body'),
      done: progress.dated,
      onClick: () => open('timelineItem', { mode: 'event', initial: { date: TODAY } }),
      label: t('firstSteps.dated.action'),
    },
    {
      id: 'reminder',
      title: t('firstSteps.reminder.title'),
      body: t('firstSteps.reminder.body'),
      done: progress.reminder,
      onClick: () => open('timelineItem', { mode: 'reminder' }),
      label: t('firstSteps.reminder.action'),
    },
  ]

  const done = steps.filter((s) => s.done).length
  const complete = done === steps.length

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={t('firstSteps.hint', { done, total: steps.length })}>
        {t('firstSteps.title')}
      </PanelTitle>
      {/* "Nothing is tracked yet" was true only until the first step landed,
          and the panel now outlives that. The line states what is true now. */}
      <p className="mb-3 text-sm text-text-2">
        {complete
          ? t('firstSteps.complete')
          : done === 0
            ? t('firstSteps.introBare')
            : t('firstSteps.intro')}
      </p>

      <ol className="divide-y divide-hairline">
        {steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
            <span
              aria-hidden
              className={cn(
                'tabular mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border text-xs font-semibold',
                s.done
                  ? 'border-success-border bg-success-soft text-success'
                  : 'border-accent-border bg-accent-soft text-accent',
              )}
            >
              {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
            </span>

            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-medium">
                {s.title}
                <span className="sr-only">
                  {' '}
                  {s.done ? t('firstSteps.doneSr') : t('firstSteps.notDoneSr')}
                </span>
              </p>
              <p className="mt-1 text-sm text-text-2">{s.body}</p>
            </div>

            <div className="shrink-0 self-center">
              <Button variant="outline" size="sm" onClick={s.onClick}>
                {s.label}
              </Button>
            </div>
          </li>
        ))}
      </ol>

      {/* The way out, at either end of the journey. Without it the panel is a
          modal you cannot close: it sits over the deck for as long as one step
          is outstanding, and a user who does not want a third record has no way
          back to their own dashboard. */}
      <div className="mt-4 flex justify-end">
        <Button
          variant={complete ? 'outline' : 'ghost'}
          size="sm"
          onClick={onClose}
          title={complete ? undefined : t('firstSteps.hideHint')}
        >
          {complete ? t('firstSteps.close') : t('firstSteps.hide')}
        </Button>
      </div>
    </Panel>
  )
}

export function PriorityActions() {
  const { t } = useTranslation('dashboard')
  const actions = usePriorityActions()
  const progress = useFirstStepsProgress()

  /**
   * The checklist is remembered, not re-derived from the condition that opened
   * it and not latched to this mount.
   *
   * It used to render only while the store held no applications — so pressing
   * its own "New application" button, which is step 1 and the obvious first
   * move, created the record that closed the gate and took steps 2 and 3 with
   * it. Latching it per mount fixed that only for a reader who never left the
   * dashboard: clicking Applications in the sidebar, adding the first job
   * there and coming back destroyed the card at 1 of 3, permanently, because
   * the latch went with the unmount. The exploring user is the one who needs
   * the remaining steps and was exactly the one who lost them.
   *
   * `lib/onboarding.ts` now holds the two flags, beside the ones the first-run
   * dialogs use — a browser preference about a panel, not a record the user
   * authored, so it stays out of the store for the reasons that file gives.
   */
  const bare = !progress.application && !progress.dated && !progress.reminder
  const [opened, setOpened] = useState(checklistOpened)
  const [closed, setClosed] = useState(checklistClosed)

  useEffect(() => {
    // A bare store opens it and un-dismisses it, so emptying the records in
    // Settings lands the user back on the walkthrough rather than on a deck
    // that computes "nothing needs deciding" from nothing.
    if (!bare) return
    openChecklist()
    setOpened(true)
    setClosed(false)
  }, [bare])

  const checklistOpen = opened && !closed

  if (checklistOpen) {
    return (
      <FirstSteps
        progress={progress}
        onClose={() => {
          closeChecklist()
          setClosed(true)
        }}
      />
    )
  }

  // Clearing the deck with records still in the store is an achievement, and
  // it is reachable now that items can be ticked off and applications deleted.
  // Say so, and still leave something to press.
  if (actions.length === 0) {
    return (
      <Panel className="min-w-0">
        <PanelTitle>{t('priority.title')}</PanelTitle>
        <EmptyState
          icon={CircleCheckBig}
          title={t('priority.emptyTitle')}
          description={t('priority.emptyDescription')}
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={applicationsPath()}>{t('common.openBoard')}</Link>
            </Button>
          }
        />
      </Panel>
    )
  }

  return (
    // A flex column so the carousel can fill the height the grid stretches
    // this panel to. See the track's own note.
    <Panel className="flex min-w-0 flex-col">
      <DecisionTimeline
        actions={chronological(actions)}
        hint={t('priority.open', { count: actions.length })}
      />
    </Panel>
  )
}
