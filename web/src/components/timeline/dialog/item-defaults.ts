import type { Stage } from '@/data/seed'
import type { TimelineKind } from '@/data/timeline'

/**
 * What a reminder about an application at this stage almost always is.
 *
 * The old default was `admin` for every mode and every context, and `admin` is
 * the one kind no panel in the app looks for. So the canonical journey — "remind
 * me to chase them" — filed a record that never reached *Follow-ups due*, the
 * panel written for exactly that sentence. Waiting on someone else is a
 * follow-up; work that is yours to do is prep; a decision you owe is admin.
 */
export const REMINDER_KIND_FOR_STAGE: Record<Stage, TimelineKind> = {
  draft: 'prep',
  submitted: 'follow-up',
  screen: 'follow-up',
  interview: 'prep',
  offer: 'admin',
  closed: 'admin',
}

/** The same question for a dated event: what actually happens on the day. */
export const EVENT_KIND_FOR_STAGE: Record<Stage, TimelineKind> = {
  draft: 'deadline',
  submitted: 'deadline',
  screen: 'call',
  interview: 'interview',
  offer: 'deadline',
  closed: 'admin',
}

export const DEFAULT_START_MINS = 9 * 60
export const DEFAULT_DURATION_MINS = 30

const pad = (n: number) => String(n).padStart(2, '0')

/** 'HH:MM', the only value an `<input type="time">` accepts. */
export const clockValue = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`

/** Back to minutes from midnight. Undefined for a cleared input, never NaN. */
export function minutesOf(value: string): number | undefined {
  const [h, m] = value.split(':')
  const mins = Number(h) * 60 + Number(m)
  return Number.isFinite(mins) ? mins : undefined
}
