import { applications, followUps, offers, thisWeek } from '@/data/seed'
import type { RoleTag } from '@/data/seed'

export type PriorityTone = 'green' | 'red' | 'amber' | 'teal'

export type PriorityAction = {
  id: string
  /** Chip shown top-left, e.g. "Offer". */
  kindLabel: string
  tone: PriorityTone
  role?: RoleTag
  title: string
  detail: string
  /** Body copy under the header. Placeholder until real notes are stored. */
  description: string
  /** Free-form tags, rendered as capsules. */
  tags: string[]
  metric: { value: string; label: string }
  facts: { label: string; value: string }[]
  actions: { label: string; to?: string; primary?: boolean }[]
}

const urgentDeadline = thisWeek.find((e) => e.kind === 'deadline' && e.urgency === 'red')
const nextInterview = applications.find((a) => a.stage === 'interview')

/**
 * The handful of things worth acting on today, newest crisis first.
 *
 * Ordering is deliberate rather than purely by date: an offer is an
 * irreversible decision with a hard expiry, so it leads even when something
 * else is due sooner. Everything after it is ordered by urgency.
 */
export const priorityActions: PriorityAction[] = [
  ...offers.map((a): PriorityAction => ({
    id: `offer-${a.id}`,
    kindLabel: 'Offer',
    tone: a.offer.daysLeft <= 3 ? 'red' : a.offer.daysLeft <= 7 ? 'amber' : 'green',
    role: a.roleTag,
    title: a.role,
    detail: a.offer.note,
    description:
      'Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.',
    tags: ['Tenure-track', 'R1', 'Relocation', 'Negotiable'],
    metric: { value: String(a.offer.daysLeft), label: 'days to decide' },
    facts: [
      { label: 'Respond by', value: a.offer.respondBy },
      ...(a.offer.comp ? [{ label: 'Package', value: a.offer.comp }] : []),
    ],
    actions: [
      { label: 'Draft response', primary: true },
      { label: 'Open application', to: '/applications' },
    ],
  })),

  ...(urgentDeadline
    ? [
        {
          id: `deadline-${urgentDeadline.id}`,
          kindLabel: 'Deadline',
          tone: 'red' as const,
          role: 'Assistant Professor' as const,
          title: urgentDeadline.title,
          detail: 'Research, teaching and diversity statements still unfinished',
          description:
            'Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.',
          tags: ['Research statement', 'Teaching', 'Diversity', 'Hard deadline'],
          metric: { value: String(urgentDeadline.inDays), label: 'days left' },
          facts: [
            { label: 'Due', value: 'Oct 15' },
            { label: 'Missing', value: '3 statements' },
          ],
          actions: [
            { label: 'Draft with assistant', primary: true },
            { label: 'Open application', to: '/applications' },
          ],
        } satisfies PriorityAction,
      ]
    : []),

  ...(followUps.length > 0
    ? [
        {
          id: 'followups',
          kindLabel: 'Follow-ups',
          tone: 'red' as const,
          title: `${followUps.length} follow-ups are overdue`,
          detail: followUps.map((f) => f.org).join(' · '),
          description:
            'Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.',
          tags: ['Email', 'Recruiter', 'Overdue', 'Low effort'],
          metric: { value: String(followUps.length), label: 'awaiting a nudge' },
          facts: [
            { label: 'Oldest', value: '24 days' },
            { label: 'Next up', value: followUps[0].org },
          ],
          actions: [{ label: 'Draft emails', primary: true }],
        } satisfies PriorityAction,
      ]
    : []),

  ...(nextInterview
    ? [
        {
          id: `interview-${nextInterview.id}`,
          kindLabel: 'Interview',
          tone: 'amber' as const,
          role: nextInterview.roleTag,
          title: nextInterview.role,
          detail: nextInterview.note,
          description:
            'Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.',
          tags: ['Job talk', 'On-site', '5 rounds', 'Panel'],
          metric: { value: '18', label: 'days to prep' },
          facts: [
            { label: 'Format', value: '5 rounds' },
            { label: 'Date', value: 'Oct 30' },
          ],
          actions: [
            { label: 'Start prep', primary: true },
            { label: 'Open application', to: '/applications' },
          ],
        } satisfies PriorityAction,
      ]
    : []),
]
