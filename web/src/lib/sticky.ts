/**
 * A reminder made from a sticky: its first line is the title, anything after
 * it the detail. Dated today, which the dialog lets the person change — a note
 * becomes a reminder precisely when it acquires a date, and the dialog is
 * where that date gets chosen.
 */
export function reminderFromNote(text: string, today: string) {
  const [first = '', ...rest] = text.trim().split('\n')
  const title = first.trim()
  const detail = rest.join('\n').trim()
  return {
    title: title.length > 120 ? `${title.slice(0, 119)}…` : title,
    date: today,
    ...(detail ? { detail } : {}),
  }
}
