/**
 * What a timeline item's form has to be holding before it may be written.
 *
 * Out of `sheets/TimelineItemSheet.tsx` because the guard there was wrong and
 * nothing could run it. `onSave` checked the title and the date and NOT the
 * start time, while the Start-time field beside it was already showing "Use a
 * time like 14:30." — so a form that had told the user it was wrong saved
 * anyway, and it did not save what they typed: `startMins` came back undefined
 * from `minutesOf`, `timed` went false, and the patch was written as an ALL-DAY
 * item with the All-day switch visibly off. A 9 a.m. interview typed as `9`
 * landed on the calendar as an untimed row.
 *
 * A field is either the authority on what it accepts or it is decoration. Save
 * and the field ask the same function here, so a third answer cannot appear.
 *
 * `clockValue` and `minutesOf` are the phone's, not the browser's, and that is
 * the reason they are not shared with web's `timeline/dialog/item-defaults.ts`:
 * web reads an `<input type="time">`, which the browser has already constrained
 * to HH:MM, so its `minutesOf` may be lax about anything a person could type.
 * This one is fed a free-text `TextField` on a numeric keypad — there is no
 * time picker in the middle — so it is the only thing standing between `9`,
 * `25:00`, `99:99` and the store.
 */

/** True whenever the form is describing a timed item rather than an all-day one. */
export type TimelineFormValues = {
  title: string
  /** 'YYYY-MM-DD', or empty while the date field is being cleared. */
  date: string
  allDay: boolean
  /** The raw text in the Start time field. Only read when `allDay` is off. */
  time: string
}

export type TimelineFormErrors = {
  title?: string
  date?: string
  time?: string
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Minutes from midnight back to 'HH:MM'. */
export const clockValue = (mins: number) => `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`

/**
 * 'HH:MM' to minutes from midnight. Undefined for anything unparseable, never NaN.
 *
 * The regex anchors both ends and fixes the minutes at two digits on purpose:
 * `Number('9')` is 9, so an unanchored split accepts `9` as 09:00 and `9:5` as
 * 09:05 — readings the person typing them did not ask for. Undefined is the
 * only honest answer to a time nobody has finished typing.
 */
export function minutesOf(value: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return undefined
  const mins = Number(match[1]) * 60 + Number(match[2])
  return Number.isFinite(mins) && mins >= 0 && mins < 24 * 60 ? mins : undefined
}

/**
 * Every field that is not yet good enough to save, with the sentence it shows.
 *
 * Returns the WHOLE set rather than the first failure: the three fields are on
 * screen together, and fixing them one refused save at a time is the interaction
 * this replaces.
 */
export function timelineFormErrors({
  title,
  date,
  allDay,
  time,
}: TimelineFormValues): TimelineFormErrors {
  return {
    ...(title.trim() ? {} : { title: 'Give it a title you will recognise.' }),
    ...(date ? {} : { date: 'Pick a date — an undated item has nowhere to appear.' }),
    // Only asked when the switch says there is a time to give. An all-day item
    // keeps whatever is in the box so that flipping the switch back gives the
    // typed time rather than the default, and half-typed text sitting behind a
    // hidden field must not block Save.
    ...(allDay || minutesOf(time) !== undefined ? {} : { time: 'Use a time like 14:30.' }),
  }
}

/** Whether `onSave` may proceed. One reading, so the button and the fields agree. */
export const canSaveTimelineItem = (errors: TimelineFormErrors) =>
  errors.title === undefined && errors.date === undefined && errors.time === undefined
