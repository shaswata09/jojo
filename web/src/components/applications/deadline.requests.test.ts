/**
 * Q296: the application's deadline shows at the top of its details. This holds
 * the rule for WHICH dated item that is; `detail/DetailHeader.requests.test.ts`
 * holds that the header draws it.
 *
 * The deadline the application form set is told apart from every other
 * `kind: 'deadline'` on the record by its detail line. An offer's respond-by
 * date is also a deadline, and showing it as "the application deadline" would
 * answer the wrong question.
 */

import { describe, expect, it } from 'vitest'
import type { TimelineItem } from '@/data/timeline'
import { DEADLINE_DETAIL, applicationDeadlineOf } from './deadline'

const item = (id: string, over: Partial<TimelineItem>): TimelineItem => ({
  id,
  title: id,
  date: '2026-11-20',
  allDay: true,
  kind: 'deadline',
  urgency: 'gray',
  applicationIds: ['app1'],
  remind: true,
  ...over,
})

describe('Q296 — the deadline shown at the top of an application', () => {
  it('is the deadline the application form set', () => {
    const items = [
      item('respond', { detail: 'Offer response due' }),
      item('form', { detail: DEADLINE_DETAIL, date: '2026-12-01' }),
    ]
    expect(applicationDeadlineOf(items)?.id).toBe('form')
  })

  it('is not an offer’s respond-by date, nor an interview', () => {
    const items = [
      item('respond', { detail: 'Offer response due' }),
      item('call', { kind: 'interview', detail: DEADLINE_DETAIL }),
    ]
    expect(applicationDeadlineOf(items)).toBeUndefined()
  })
})
