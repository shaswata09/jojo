export type ReminderStatus = 'overdue' | 'today' | 'upcoming' | 'done'
export type ReminderKind = 'follow-up' | 'deadline' | 'prep' | 'admin'

export type Reminder = {
  id: string
  title: string
  /** The application or organisation this hangs off. */
  related: string
  due: string
  /** Human phrasing of the gap, e.g. "8 days overdue". */
  when: string
  status: ReminderStatus
  kind: ReminderKind
  note?: string
}

export const reminders: Reminder[] = [
  {
    id: 'ut-receipt',
    title: 'Confirm application was received',
    related: 'UT Austin — Assistant professor, CS',
    due: 'Oct 4',
    when: '8 days overdue',
    status: 'overdue',
    kind: 'follow-up',
    note: 'Search chair: Dr. Smith',
  },
  {
    id: 'tamu-nudge',
    title: 'Nudge on application status',
    related: 'Texas A&M — Assistant professor, ECE',
    due: 'Oct 6',
    when: '6 days overdue',
    status: 'overdue',
    kind: 'follow-up',
    note: 'No response in 21 days',
  },
  {
    id: 'databricks-chase',
    title: 'Chase recruiter reply',
    related: 'Databricks — ML engineer',
    due: 'Oct 9',
    when: '3 days overdue',
    status: 'overdue',
    kind: 'follow-up',
    note: 'They said "next week" on Oct 3',
  },
  {
    id: 'ut-statements',
    title: 'Finalize research and teaching statements',
    related: 'UT Austin — Assistant professor, CS',
    due: 'Oct 12',
    when: 'Today',
    status: 'today',
    kind: 'prep',
    note: 'Deadline is Thursday',
  },
  {
    id: 'tt-letters',
    title: 'Request third reference letter',
    related: 'Texas Tech — Assistant professor, ECE',
    due: 'Oct 14',
    when: 'in 2 days',
    status: 'upcoming',
    kind: 'admin',
  },
  {
    id: 'stripe-cv',
    title: 'Tailor CV to the posting',
    related: 'Stripe — ML engineer',
    due: 'Oct 16',
    when: 'in 4 days',
    status: 'upcoming',
    kind: 'prep',
  },
  {
    id: 'uh-travel',
    title: 'Book travel for campus visit',
    related: 'UH — Assistant professor, CS',
    due: 'Oct 24',
    when: 'in 12 days',
    status: 'upcoming',
    kind: 'admin',
    note: 'Visit is Nov 6',
  },
  {
    id: 'baylor-decide',
    title: 'Respond to offer',
    related: 'Baylor — Assistant professor, CS',
    due: 'Nov 15',
    when: 'in 34 days',
    status: 'upcoming',
    kind: 'deadline',
    note: 'Negotiating startup package',
  },
  {
    id: 'tamu-submit',
    title: 'Submit application',
    related: 'Texas A&M — Assistant professor, ECE',
    due: 'Oct 2',
    when: 'Completed Oct 2',
    status: 'done',
    kind: 'deadline',
  },
  {
    id: 'stripe-referral',
    title: 'Ask D. Chen for a referral',
    related: 'Stripe — ML engineer',
    due: 'Sep 28',
    when: 'Completed Sep 28',
    status: 'done',
    kind: 'admin',
  },
]

export const REMINDER_GROUPS: { status: ReminderStatus; label: string }[] = [
  { status: 'overdue', label: 'Overdue' },
  { status: 'today', label: 'Today' },
  { status: 'upcoming', label: 'Upcoming' },
  { status: 'done', label: 'Completed' },
]
