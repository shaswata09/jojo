/**
 * Whether a date input's value is one somebody could have meant, rather than a
 * stop on the way to it.
 *
 * WHY THIS EXISTS. A native `<input type="date">` reports a value as soon as
 * every segment holds something, and typing the year one digit at a time walks
 * through '0002-09-14', '0020-09-14' and '0202-09-14' before '2026-09-14'.
 * Writing on each of those either fails (the store refuses year 2 as a day that
 * does not exist, and the controlled field is reset, wiping the month and day
 * already typed) or succeeds with a date nobody meant. A field that writes as
 * you type therefore waits for this; anything else stays a local draft until
 * the person commits it with Enter or by leaving the field.
 *
 * 1900 is the floor because nothing a job search records happened before it,
 * and the first four-digit year a typist passes through is the one they meant.
 */
export function isWholeDate(value: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (y < 1900 || mo < 1 || mo > 12 || d < 1) return false
  // Day 0 of the next month is the last day of this one.
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}
