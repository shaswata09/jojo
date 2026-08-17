import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'
import { CalendarClock, Check, CircleCheckBig } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { SnoozeSteps } from '@/components/common/SnoozeSteps'
import { snoozeAnchor } from '@/components/common/snooze'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { addDays, shortDate } from '@/data/timeline'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useDialogs } from '@/lib/dialogs-context'
import { applicationsPath } from '@/lib/links'
import { usePriorityActions, type PriorityAction } from '@/lib/priority'
import { MARK_TEXT } from '@/lib/timeline-visuals'
import type { DateMark } from '@/lib/timeline-visuals'
import { useToast } from '@/lib/toast-context'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

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
function ItemControls({ itemId, size = 'sm' }: { itemId: string; size?: 'sm' | 'xs' }) {
  const { get, toggleDone, update, snooze, reschedule } = useTimeline()
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const item = get(itemId)
  if (!item) return null

  // The store counts from today only for an overdue item, and the toast below
  // has to name the same day the write lands on.
  const anchor = snoozeAnchor(item.date)

  const done = () => {
    toggleDone(item.id)
    toast({
      title: `${item.title} completed`,
      description: 'It leaves the deck and this week — nothing is deleted.',
      // Not a second toggleDone: by the time this is pressed the item may have
      // been unticked elsewhere, and toggling again would re-tick it.
      action: { label: 'Undo', onClick: () => update(item.id, { completedOn: null }) },
    })
  }

  const push = (days: number) => {
    const before = item.date
    setOpen(false)
    snooze(item.id, days)
    toast({
      title: `${item.title} rescheduled`,
      description: `Now due ${shortDate(addDays(anchor, days))}, on the calendar and the week ahead.`,
      action: { label: 'Undo', onClick: () => reschedule(item.id, before) },
    })
  }

  return (
    <>
      <Button variant="ghost" size={size} title={`Tick "${item.title}" off`} onClick={done}>
        <Check className="size-3.5" strokeWidth={2} aria-hidden />
        Done
      </Button>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size={size} title={`Push "${item.title}" out`}>
            <CalendarClock className="size-3.5" strokeWidth={1.8} aria-hidden />
            Snooze
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-48 gap-1 p-1.5">
          <div className="px-1 pb-0.5 text-xs tracking-wide text-text-3 uppercase">Push out by</div>
          <SnoozeSteps date={item.date} spell="duration" onPick={push} />
        </PopoverContent>
      </Popover>
    </>
  )
}

function ActionButton({ action }: { action: PriorityAction['actions'][number] }) {
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
      title={action.blocker ?? (action.draft ? undefined : 'Nothing is connected to this yet')}
      onClick={action.draft ? () => open('draft', action.draft) : undefined}
    >
      {action.label}
    </Button>
  )
}

/**
 * The first card, at full size.
 *
 * Inverted from what it was: the headline is the instruction ("Reply to
 * Baylor"), the date is stated once at 11px, and the thing that actually moves
 * the decision along — Draft a reply — is the filled button. Previously the
 * loudest element was a 28px countdown and the primary action was a ghost.
 *
 * No background of its own. A second surface inside a panel reads as a hole;
 * the border is enough to say "card", and it is the border that carries the
 * one permitted colour.
 */
function HeroCard({ action }: { action: PriorityAction }) {
  return (
    <div className={cn('rounded-md border px-3.5 py-3', URGENCY_BORDER[action.urgency])}>
      <Chip tone="gray" size="sm">
        {action.kindLabel}
      </Chip>

      <h3 className="mt-2 text-xl font-semibold">{action.headline}</h3>
      <p className="mt-1 line-clamp-1 text-sm text-text-2">{action.context}</p>
      <p className={cn('mt-1.5 text-xs', MARK_TEXT[action.urgency])}>{action.timing}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {action.actions.map((a) => (
          <ActionButton key={a.label} action={a} />
        ))}
        {/* Done and Snooze come last: they end the card, and putting them first
            would put "dismiss this" ahead of "deal with it". */}
        {action.itemId ? <ItemControls itemId={action.itemId} /> : null}
      </div>
    </div>
  )
}

/**
 * Everything after the first card, one line each.
 *
 * This replaces a scroll-snap carousel. Three decisions were reachable only by
 * pressing an arrow, the off-screen ones stayed in the tab order, and the track
 * was an `aria-live` region that re-announced a full card on every scroll tick.
 * All of it is visible at once now and none of it announces anything.
 */
function ActionRow({ action }: { action: PriorityAction }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <Chip tone="gray" size="sm" className="shrink-0">
        {action.kindLabel}
      </Chip>

      <span className="min-w-0 flex-1 basis-40 truncate text-sm font-medium">
        {action.headline}
      </span>

      <span className={cn('shrink-0 text-xs whitespace-nowrap', MARK_TEXT[action.urgency])}>
        {action.timing}
      </span>

      <div className="flex shrink-0 items-center gap-1">
        {action.itemId ? (
          <ItemControls itemId={action.itemId} size="xs" />
        ) : (
          // A row with nothing dated behind it still has to be pressable, so it
          // falls back to whatever the card itself calls primary.
          <ActionButton action={action.actions.find((a) => a.primary) ?? action.actions[0]} />
        )}
      </div>
    </li>
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
  const { open } = useDialogs()

  const steps = [
    {
      id: 'application',
      title: 'Add an application',
      body: 'A position, its stage and its deadline. Everything else in jojo hangs off this record.',
      done: progress.application,
      onClick: () => open('application'),
      label: 'New application',
    },
    {
      id: 'dated',
      title: 'Give something a date',
      body: 'Deadlines, interviews and visits are one kind of record, so a date reaches this page, the calendar and the application at once.',
      done: progress.dated,
      onClick: () => open('timelineItem', { mode: 'event', initial: { date: TODAY } }),
      label: 'New event',
    },
    {
      id: 'reminder',
      title: 'Set a follow-up',
      body: 'A reminder is the same record with a nudge switched on. Once its date passes it is owed, and it stays here until you tick it off.',
      done: progress.reminder,
      onClick: () => open('timelineItem', { mode: 'reminder' }),
      label: 'New reminder',
    },
  ]

  const done = steps.filter((s) => s.done).length
  const complete = done === steps.length

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={`${done} of ${steps.length} done`}>First steps</PanelTitle>
      {/* "Nothing is tracked yet" was true only until the first step landed,
          and the panel now outlives that. The line states what is true now. */}
      <p className="mb-3 text-sm text-text-2">
        {complete
          ? 'All three are done. Anything you add from here reaches this page, the calendar and the application it belongs to.'
          : `${done === 0 ? 'Nothing is tracked yet. ' : ''}Each step opens the real thing and ticks itself once a record exists — none of it is a tutorial you have to sit through.`}
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
                <span className="sr-only">{s.done ? ' — done' : ' — not done yet'}</span>
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
          title={complete ? undefined : 'The same steps are written out in the guide'}
        >
          {complete ? 'Close first steps' : 'Hide these steps'}
        </Button>
      </div>
    </Panel>
  )
}

export function PriorityActions() {
  const actions = usePriorityActions()
  const progress = useFirstStepsProgress()

  /**
   * The checklist is latched open, not re-derived from the condition that
   * opened it.
   *
   * It rendered only while the store held no applications — so pressing its own
   * "New application" button, which is step 1 and the obvious first move,
   * created the record that closed the gate and took steps 2 and 3 with it. The
   * counter could never reach 3 of 3 and the panel's own promise that each step
   * "ticks itself once a record exists" was unobservable for two thirds of it.
   *
   * It now opens on a bare store and closes only when the user closes it, so
   * the journey can finish. The latch is per-mount: navigating away mid-way
   * drops it, which is the price of not putting a piece of onboarding chrome in
   * the store beside the user's records.
   */
  const bare = !progress.application && !progress.dated && !progress.reminder
  const [checklistOpen, setChecklistOpen] = useState(bare)
  useEffect(() => {
    // Reopens if the store is emptied later in the session — Settings → Records
    // → Clear everything lands the user back on exactly this screen.
    if (bare) setChecklistOpen(true)
  }, [bare])

  if (checklistOpen) {
    return <FirstSteps progress={progress} onClose={() => setChecklistOpen(false)} />
  }

  // Clearing the deck with records still in the store is an achievement, and
  // it is reachable now that items can be ticked off and applications deleted.
  // Say so, and still leave something to press.
  if (actions.length === 0) {
    return (
      <Panel className="min-w-0">
        <PanelTitle>Needs a decision</PanelTitle>
        <EmptyState
          icon={CircleCheckBig}
          title="Nothing needs deciding today"
          description="Offers, the next hard deadline and your next interview surface here. None of them is outstanding."
          action={
            <Button variant="outline" size="sm" asChild>
              <Link to={applicationsPath()}>Open the board</Link>
            </Button>
          }
        />
      </Panel>
    )
  }

  const [first, ...rest] = actions

  return (
    <Panel className="min-w-0">
      <PanelTitle hint={actions.length === 1 ? '1 open' : `${actions.length} open`}>
        Needs a decision
      </PanelTitle>

      <HeroCard action={first} />

      {rest.length > 0 ? (
        <ul className="mt-1 divide-y divide-hairline">
          {rest.map((action) => (
            <ActionRow key={action.id} action={action} />
          ))}
        </ul>
      ) : null}
    </Panel>
  )
}
