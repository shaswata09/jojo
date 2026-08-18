import { useMemo } from 'react'
import { TODAY } from '@/lib/today'
import { offerDaysLeft } from '@jojo/service/data/seed'
import { daysBetween, shortDate } from '@jojo/service/data/timeline'
import { useApplications, useTimeline } from '@/lib/store-context'

/**
 * How close a date is, and the only thing on the deck allowed to carry colour.
 *
 * red = past due, amber = due inside 48 hours, nothing else. Derived from the
 * date on every read rather than stored, so a card cannot say "3 days overdue"
 * beside an amber marker the way the hand-written `urgency` field allowed.
 */
export type PriorityUrgency = 'overdue' | 'soon' | 'none'

export type PriorityAction = {
  id: string
  /** Chip shown above the headline, e.g. "Offer". Neutral — never a tone. */
  kindLabel: string
  /** Imperative: what to do about the record, not what the record is called. */
  headline: string
  /** One line, read off the record. Clamped by the card, so put the point first. */
  context: string
  /**
   * The date, stated exactly once, in the app's one relative vocabulary.
   * The card used to print it twice in two units and render the least urgent
   * half at 28px, which made "34 days" the loudest thing on the dashboard.
   */
  timing: string
  urgency: PriorityUrgency
  /**
   * The dated item this card is about, when there is one.
   *
   * It is what makes Done and Snooze possible: both write to the timeline, so a
   * card with nothing dated behind it — an offer, which is a decision rather
   * than an appointment — simply does not offer them, instead of showing two
   * buttons that would have nothing to write to.
   */
  itemId?: string
  /**
   * `appId` makes it a link to that record, `draft` opens the draft sheet
   * seeded with it. Every "draft it for me" here used to carry a `blocker`
   * naming a model nobody has connected; the sheet it points at now needs no
   * model — it starts from the user's own email snippets. `blocker` survives
   * for anything that genuinely cannot be done, and disables the button with
   * the reason on it.
   *
   * The web version spelled the destination as a route string through
   * `appPath()`. There are no URLs here, so it is the record's id and the
   * caller navigates.
   */
  actions: {
    label: string
    appId?: string
    primary?: boolean
    draft?: { itemId?: string; applicationId?: string }
    blocker?: string
  }[]
}

function urgencyOf(iso: string): PriorityUrgency {
  const gap = daysBetween(TODAY, iso)
  if (gap < 0) return 'overdue'
  // "Inside 48 hours" is today and tomorrow — the only two days amber may claim.
  return gap <= 1 ? 'soon' : 'none'
}

/**
 * `Today / Tomorrow / in N days / N days overdue`, from a bare ISO date.
 *
 * Deliberately not `whenLabel`, which takes a whole `TimelineItem`: an offer's
 * respond-by date lives on the application and has no timeline row behind it,
 * and faking one to borrow the formatter is how a `completedOn` branch ends up
 * running against an object that never had the field. Same vocabulary, checked
 * against `data/timeline.ts` — if that list ever grows a case, this grows it too.
 */
function relativeLabel(iso: string): string {
  const gap = daysBetween(TODAY, iso)
  if (gap === -1) return '1 day overdue'
  if (gap < 0) return `${-gap} days overdue`
  if (gap === 0) return 'Today'
  if (gap === 1) return 'Tomorrow'
  return `in ${gap} days`
}

const sentence = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

/**
 * The handful of things worth deciding today, most irreversible first.
 *
 * A hook rather than the module-scope array it was: every date here is read off
 * the store, so ticking a follow-up off in the Vault or moving a card on the
 * board has to be able to empty a card — computed once at import it would go
 * stale the first time the user touched anything.
 *
 * The overdue-follow-ups summary that used to sit here is gone. It claimed the
 * same three rows the sidebar badge, the glance counter and the "Owed this
 * week" panel already claim, so one screen reported them four times. What is
 * left is only what has no panel of its own: the offer, the next hard deadline,
 * and the next interview.
 */
export function usePriorityActions(): PriorityAction[] {
  const { all, offers } = useApplications()
  const { all: items, thisWeek } = useTimeline()

  return useMemo(() => {
    // Soonest first, and selected by date rather than by the stored `urgency`
    // flag — a deadline written down as amber is still the next hard date.
    const nextDeadline = thisWeek.find((i) => i.kind === 'deadline')
    const nextInterview = all.find((a) => a.stage === 'interview')
    // The interview itself lives on the timeline, so the date and the format
    // come from the event rather than from a second copy on the application.
    const interviewEvent = nextInterview
      ? items.find((i) => i.applicationId === nextInterview.id && i.kind === 'interview')
      : undefined
    const orgOf = (applicationId?: string) =>
      all.find((a) => a.id === applicationId)?.org ?? 'Unknown'

    return [
      ...offers.map((a): PriorityAction => {
        // `TODAY`, threaded from the app shell. The deleted fixture copy of
        // this function defaulted the second argument to a `TODAY` frozen at
        // the fixtures' October, so every offer countdown on the phone was
        // measured against a date that never moves. D26 makes the clock the
        // shell's to supply, and the required parameter is what turned that
        // from a wrong number into a compile error.
        const daysLeft = offerDaysLeft(a.offer, TODAY)
        return {
          id: `offer-${a.id}`,
          kindLabel: 'Offer',
          headline: `Reply to ${a.org}`,
          context: sentence(a.role, a.offer.comp, a.offer.note),
          timing: `Respond by ${shortDate(a.offer.respondBy)} · ${relativeLabel(a.offer.respondBy)}`,
          urgency: urgencyOf(a.offer.respondBy),
          actions: [
            { label: 'Draft a reply', primary: true, draft: { applicationId: a.id } },
            {
              label: daysLeft < 0 ? 'Record what happened' : 'Accept or decline',
              appId: a.id,
            },
          ],
        }
      }),

      ...(nextDeadline
        ? [
            {
              id: `deadline-${nextDeadline.id}`,
              kindLabel: 'Deadline',
              headline: `Submit to ${orgOf(nextDeadline.applicationId)}`,
              context: sentence(nextDeadline.title, nextDeadline.detail ?? nextDeadline.note),
              timing: `Due ${shortDate(nextDeadline.date)} · ${relativeLabel(nextDeadline.date)}`,
              urgency: urgencyOf(nextDeadline.date),
              itemId: nextDeadline.id,
              actions: [
                { label: 'Draft a message', primary: true, draft: { itemId: nextDeadline.id } },
                {
                  label: 'Open application',
                  // The deadline knows which application it belongs to; before
                  // this the button went to the list and left you to find it.
                  ...(nextDeadline.applicationId
                    ? { appId: nextDeadline.applicationId }
                    : { blocker: 'This deadline is not filed under an application' }),
                },
              ],
            } satisfies PriorityAction,
          ]
        : []),

      ...(nextInterview
        ? [
            {
              id: `interview-${nextInterview.id}`,
              kindLabel: 'Interview',
              headline: interviewEvent
                ? `Prepare for ${nextInterview.org}`
                : `Date the ${nextInterview.org} interview`,
              context: interviewEvent
                ? sentence(nextInterview.role, interviewEvent.detail, interviewEvent.location)
                : 'At interview stage with nothing dated against it, so neither the week ahead nor the calendar can show it.',
              timing: interviewEvent
                ? `${shortDate(interviewEvent.date)} · ${relativeLabel(interviewEvent.date)}`
                : 'No date set',
              urgency: interviewEvent ? urgencyOf(interviewEvent.date) : 'none',
              itemId: interviewEvent?.id,
              actions: interviewEvent
                ? [
                    {
                      label: 'Draft a message',
                      primary: true,
                      draft: { applicationId: nextInterview.id, itemId: interviewEvent.id },
                    },
                    { label: 'Open application', appId: nextInterview.id },
                  ]
                : // Nothing to draft against an interview with no date — the
                  // record is where the date gets added, so it leads instead.
                  [{ label: 'Open application', primary: true, appId: nextInterview.id }],
            } satisfies PriorityAction,
          ]
        : []),
    ]
  }, [all, offers, items, thisWeek])
}
