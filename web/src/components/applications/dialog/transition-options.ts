import type { Outcome } from '@/data/seed'

export const FORMATS = [
  { value: 'phone', label: 'Phone' },
  { value: 'video', label: 'Video' },
  { value: 'onsite', label: 'Onsite' },
] as const

export type Format = (typeof FORMATS)[number]['value']

export const FORMAT_LABEL = Object.fromEntries(FORMATS.map((f) => [f.value, f.label])) as Record<
  Format,
  string
>

export const OUTCOMES: { value: Outcome; label: string }[] = [
  { value: 'rejected', label: 'Rejected' },
  { value: 'withdrawn', label: 'Withdrawn' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' },
  { value: 'ghosted', label: 'Ghosted — no reply' },
]

export const OUTCOME_LABEL = Object.fromEntries(OUTCOMES.map((o) => [o.value, o.label])) as Record<
  Outcome,
  string
>

/** What the activity feed should say afterwards. */
export const OUTCOME_ACTION: Record<Outcome, string> = {
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
  accepted: 'Offer accepted',
  declined: 'Offer declined',
  ghosted: 'Closed with no reply',
}
