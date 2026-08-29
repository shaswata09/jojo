/**
 * The save guard for a reminder or an event, and specifically the third field
 * it did not have.
 *
 * `TimelineItemSheet.onSave` checked the title and the date. The Start-time
 * field checked the time and said so on screen, and Save ignored it — so the
 * one input on the form that can be typed WRONG rather than merely left empty
 * was the one input that could not stop a write. Worse than a bad record: the
 * unparseable time fell through as `undefined`, which the patch reads as an
 * all-day item, so `9` typed into a 9 a.m. interview was filed with no time at
 * all while the All-day switch was visibly off.
 */

import { describe, expect, it } from 'vitest'
import { canSaveTimelineItem, clockValue, minutesOf, timelineFormErrors } from './timeline-form'

const form = (over: Partial<Parameters<typeof timelineFormErrors>[0]> = {}) => ({
  title: 'Committee Zoom',
  date: '2026-09-01',
  allDay: false,
  time: '14:30',
  ...over,
})

describe('a start time the field itself rejects', () => {
  // Every one of these draws 'Use a time like 14:30.' under the box, and every
  // one of them used to save — as an all-day item.
  const rejected = ['9', '99:99', '25:00', '24:00', 'half nine', '', '  ', '14.30', '9:5']

  it.each(rejected)('blocks Save for %j', (time) => {
    const errors = timelineFormErrors(form({ time }))
    expect(errors.time).toBe('Use a time like 14:30.')
    expect(canSaveTimelineItem(errors)).toBe(false)
  })

  it('says the same sentence the field shows, so the two cannot drift', () => {
    // The field renders `errors.time` directly; this is the assertion that the
    // shared reading is the one the user was already looking at.
    expect(timelineFormErrors(form({ time: '9' })).time).toBe('Use a time like 14:30.')
  })
})

describe('a start time the field accepts', () => {
  it.each([
    ['00:00', 0],
    ['09:00', 540],
    ['9:00', 540],
    ['14:30', 870],
    ['23:59', 1439],
    [' 14:30 ', 870],
  ])('lets Save through for %j', (time, mins) => {
    expect(minutesOf(time as string)).toBe(mins)
    expect(canSaveTimelineItem(timelineFormErrors(form({ time: time as string })))).toBe(true)
  })
})

describe('the All-day switch', () => {
  it('does not ask about a time that is not being used', () => {
    // The box keeps its text while the switch is on, so that flipping it back
    // returns what was typed rather than the default. Half-typed text behind a
    // hidden field must not block Save.
    const errors = timelineFormErrors(form({ allDay: true, time: 'half nine' }))
    expect(errors.time).toBeUndefined()
    expect(canSaveTimelineItem(errors)).toBe(true)
  })
})

describe('the two fields that were already guarded', () => {
  it('still refuses an untitled item', () => {
    const errors = timelineFormErrors(form({ title: '   ' }))
    expect(errors.title).toBe('Give it a title you will recognise.')
    expect(canSaveTimelineItem(errors)).toBe(false)
  })

  it('still refuses an undated item', () => {
    const errors = timelineFormErrors(form({ date: '' }))
    expect(errors.date).toBe('Pick a date — an undated item has nowhere to appear.')
    expect(canSaveTimelineItem(errors)).toBe(false)
  })

  it('reports every wrong field at once, not the first one', () => {
    // Three fields on one screen; fixing them one refused save at a time is the
    // interaction this replaces.
    const errors = timelineFormErrors({ title: '', date: '', allDay: false, time: 'x' })
    expect(Object.keys(errors).sort()).toEqual(['date', 'time', 'title'])
  })
})

describe('the round trip through the time box', () => {
  it('gives back the minutes it was built from', () => {
    for (const mins of [0, 540, 870, 1439]) expect(minutesOf(clockValue(mins))).toBe(mins)
  })
})
