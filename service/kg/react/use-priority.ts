/**
 * L4 — the priority deck: the handful of things worth deciding today, most
 * irreversible first.
 *
 * Which records surface, in what order, with which sentence on them and which
 * two buttons under them, is a reading of the store and not a fact about a
 * browser. It lived in `src/lib/priority.ts`, on the list of modules the phone
 * was told to keep in step by copying the file across — and the project's own
 * notes already record that this is one of the two that "diverge on purpose",
 * on exactly the field this hook now takes as an argument. A rule that is
 * maintained by copy-paste and already known to have forked is the rule to move
 * first.
 *
 * The one platform fact is where an application LIVES. On the web that is a
 * route string from `appPath`; on a phone it is a screen and a param. So it
 * arrives as `appHref`, a single function, rather than the hook reaching for a
 * router — which is the same shape as `Host` and `Driver`, at a much smaller
 * size. It is not an abstraction written ahead of its consumer: the second
 * consumer already exists and already disagrees here.
 *
 * `today` comes from the provider (D26), not from a module constant. That is
 * also the one behavioural difference from the version this replaces, which read
 * `TODAY` — a separate clock read, frozen at module load. The deck already
 * consumed `thisWeek` from `useTimeline`, which is bucketed against the
 * provider's day, so it was measuring the buckets against one day and the
 * colours against another; they can only disagree in a session left open across
 * midnight, and now they cannot disagree at all.
 */

import { useMemo } from 'react'
import { offerDaysLeft } from '../core/dates'
import { daysBetween, shortDate } from '../core/dates'
import type { Addressable } from '../core/address'
import type { Application, TimelineItem } from '../core/model'
import { useApplications } from './use-applications'
import { useTimeline } from './use-timeline'
import { useKg } from './kg-context'
import { dateMarkOn } from '../core/timeline-view'
import type { DateMark } from '../core/timeline-view'

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
  /**
   * How close the date is, and the only thing on the deck allowed to carry
   * colour. Derived on every read rather than stored, so a card cannot say
   * "3 days overdue" beside an amber marker the way the hand-written `urgency`
   * field allowed.
   */
  urgency: DateMark
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
   * `to` makes it a link, `draft` opens the draft dialog seeded with that
   * record. Every "draft it for me" here used to carry a `blocker` naming a
   * model nobody has connected; the dialog it points at now needs no model —
   * it starts from the user's own email snippets. `blocker` survives for
   * anything that genuinely cannot be done, and greys the button out with the
   * reason on it.
   *
   * `to` is whatever `appHref` returned, so its shape is the caller's business
   * and not this hook's.
   */
  actions: {
    label: string
    to?: string
    primary?: boolean
    draft?: { itemId?: string; applicationId?: string }
    blocker?: string
  }[]
}

/**
 * `Today / Tomorrow / in N days / N days overdue`, from a bare ISO date.
 *
 * Deliberately not `whenLabel`, which takes a whole `TimelineItem`: an offer's
 * respond-by date lives on the application and has no timeline row behind it,
 * and faking one to borrow the formatter is how a `completedOn` branch ends up
 * running against an object that never had the field.
 *
 * So this is the same five branches as `whenLabel`'s tail, written twice on
 * purpose. That used to be enforced by the sentence "if that list ever grows a
 * case, this grows it too", addressed to nobody. `lib/priority.test.ts` walks
 * both across a range of offsets and asserts they agree, so a case added to one
 * fails until it is added here — which is what the sentence was asking for.
 */
export function relativeLabelOn(today: string, iso: string): string {
  const gap = daysBetween(today, iso)
  if (gap === -1) return '1 day overdue'
  if (gap < 0) return `${-gap} days overdue`
  if (gap === 0) return 'Today'
  if (gap === 1) return 'Tomorrow'
  return `in ${gap} days`
}

const sentence = (...parts: (string | undefined | false)[]) => parts.filter(Boolean).join(' · ')

export type PriorityOptions = {
  /**
   * Where an application lives on this platform.
   *
   * Takes the record rather than an id because an id alone cannot address
   * anything that survives a reload — the web's URL carries the slug, and
   * `Addressable` is the two fields that answer for both.
   */
  appHref: (a: Addressable) => string
}

/**
 * The interview-stage application whose interview is SOONEST, and that event.
 *
 * It used to be `all.find((a) => a.stage === 'interview')`, which is creation
 * order — that is what `projections.applications` hands back — and then the
 * FIRST interview event filed under whatever record that found. Measured on two
 * interview-stage applications, one interviewed tomorrow and an older record
 * interviewed on 30 November, the deck named the older record, printed
 * "in 94 days" on it, and put the interview tomorrow on no card at all. The
 * deck's other two cards are already picked by date — the deadline comes off
 * `thisWeek`, which is date-ordered — and this was the one that was not.
 *
 * Scanned for a minimum rather than trusting `items` to arrive sorted. It does:
 * the timeline projection sorts by `compareItems`. But that is a rule enforced
 * two layers away, a caller passing a filtered or re-ordered list is one
 * refactor from here, and the scan costs a single pass either way. Ties keep the
 * order they arrived in, which is the projection's — all-day before timed on the
 * same day.
 *
 * Only an interview that is neither ticked off nor past can WIN the card,
 * because the card's sentence is "Prepare for X". An application whose only
 * interview event is behind it therefore falls to the tail, together with the
 * ones that have no event at all — and the tail is exactly the old behaviour,
 * kept on purpose: the first such record and whatever interview event it has, so
 * a stage set with nothing dated against it still gets its "Date the X
 * interview" card, and a past interview still reads as overdue rather than
 * vanishing.
 *
 * Exported and pure because nothing in this package renders (D20): a rule that
 * only a mounted card could observe is a rule with nothing holding it.
 */
export function nextInterviewOn(
  today: string,
  applications: readonly Application[],
  items: readonly TimelineItem[],
): { application: Application; event: TimelineItem | undefined } | undefined {
  const atStage = applications.filter((a) => a.stage === 'interview')
  const [firstAtStage] = atStage
  if (firstAtStage === undefined) return undefined

  let best: { application: Application; event: TimelineItem } | undefined
  for (const item of items) {
    if (item.kind !== 'interview' || item.completedOn || item.date < today) continue
    // `>=` and not `>`: the first item at a given date wins, so a tie is broken
    // by the order the projection chose rather than by this loop's direction.
    if (best !== undefined && item.date >= best.event.date) continue
    const application = atStage.find((a) => item.applicationIds.includes(a.id))
    if (application !== undefined) best = { application, event: item }
  }
  if (best !== undefined) return best

  return {
    application: firstAtStage,
    event: items.find(
      (i) => i.kind === 'interview' && i.applicationIds.includes(firstAtStage.id),
    ),
  }
}

/**
 * A hook rather than the module-scope array it once was: every date here is read
 * off the store, so ticking a follow-up off in the Vault or moving a card on the
 * board has to be able to empty a card — computed once at import it would go
 * stale the first time the user touched anything.
 *
 * The overdue-follow-ups summary that used to sit here is gone. It claimed the
 * same three rows the sidebar badge, the glance counter and the "Owed this week"
 * panel already claim, so one screen reported them four times. What is left is
 * only what has no panel of its own: the offer, the next hard deadline, and the
 * next interview.
 */
export function usePriorityActions({ appHref }: PriorityOptions): PriorityAction[] {
  const { today } = useKg()
  const { all, offers } = useApplications()
  const { all: items, thisWeek } = useTimeline()

  return useMemo(() => {
    // Soonest first, and selected by date rather than by the stored `urgency`
    // flag — a deadline written down as amber is still the next hard date.
    const nextDeadline = thisWeek.find((i) => i.kind === 'deadline')
    // Both halves of the interview card come from one selector, by date. See
    // `nextInterviewOn` for what that fixed and what it deliberately kept.
    const interview = nextInterviewOn(today, all, items)
    const nextInterview = interview?.application
    const interviewEvent = interview?.event
    // A deadline holds application ids, not the records, so both the headline
    // and the link have to look them up. The FIRST is used, and that is a
    // presentation choice rather than a claim: a deadline about three
    // applications still gets one headline, and naming one of them beats
    // naming none. The panel below it lists them all.
    const appOf = (applicationId?: string) => all.find((a) => a.id === applicationId)
    const orgOf = (applicationIds: readonly string[]) =>
      appOf(applicationIds[0])?.org ?? 'Unknown'
    const deadlineApp = appOf(nextDeadline?.applicationIds[0])

    return [
      ...offers.map((a): PriorityAction => {
        const daysLeft = offerDaysLeft(a.offer, today)
        return {
          id: `offer-${a.id}`,
          kindLabel: 'Offer',
          headline: `Reply to ${a.org}`,
          context: sentence(a.role, a.offer.comp, a.offer.note),
          timing: `Respond by ${shortDate(a.offer.respondBy)} · ${relativeLabelOn(today, a.offer.respondBy)}`,
          urgency: dateMarkOn(today, a.offer.respondBy),
          actions: [
            { label: 'Draft a reply', primary: true, draft: { applicationId: a.id } },
            {
              label: daysLeft < 0 ? 'Record what happened' : 'Accept or decline',
              to: appHref(a),
            },
          ],
        }
      }),

      ...(nextDeadline
        ? [
            {
              id: `deadline-${nextDeadline.id}`,
              kindLabel: 'Deadline',
              headline: `Submit to ${orgOf(nextDeadline.applicationIds)}`,
              context: sentence(nextDeadline.title, nextDeadline.detail ?? nextDeadline.note),
              timing: `Due ${shortDate(nextDeadline.date)} · ${relativeLabelOn(today, nextDeadline.date)}`,
              urgency: dateMarkOn(today, nextDeadline.date),
              itemId: nextDeadline.id,
              actions: [
                { label: 'Draft a message', primary: true, draft: { itemId: nextDeadline.id } },
                {
                  label: 'Open application',
                  // The deadline knows which application it belongs to; before
                  // this the button went to the list and left you to find it.
                  ...(deadlineApp
                    ? { to: appHref(deadlineApp) }
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
                ? `${shortDate(interviewEvent.date)} · ${relativeLabelOn(today, interviewEvent.date)}`
                : 'No date set',
              urgency: interviewEvent ? dateMarkOn(today, interviewEvent.date) : 'none',
              // Spread rather than `itemId: interviewEvent?.id`: `kg`
              // compiles with `exactOptionalPropertyTypes`, so an absent item is
              // an absent KEY and never a present one holding `undefined`. The
              // distinction is load-bearing below the seam — a structured clone
              // preserves the key, so a Done button would come back on the
              // second launch for a card with nothing to write to.
              ...(interviewEvent === undefined ? {} : { itemId: interviewEvent.id }),
              actions: interviewEvent
                ? [
                    {
                      label: 'Draft a message',
                      primary: true,
                      draft: { applicationId: nextInterview.id, itemId: interviewEvent.id },
                    },
                    { label: 'Open application', to: appHref(nextInterview) },
                  ]
                : // Nothing to draft against an interview with no date — the
                  // record is where the date gets added, so it leads instead.
                  [{ label: 'Open application', primary: true, to: appHref(nextInterview) }],
            } satisfies PriorityAction,
          ]
        : []),
    ]
  }, [all, offers, items, thisWeek, today, appHref])
}
