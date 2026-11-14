/**
 * Which element the record sheet hands focus back to when it closes.
 *
 * The sheet is non-modal and stays mounted while the person opens another
 * record — Tab out to the board, Enter on the next card — so an opener captured
 * once at mount sent focus back to the FIRST card opened, wherever the person
 * had got to since. The sheet asks again each time the record changes.
 *
 * What it is asked is what was focused or pressed just then, and that can be
 * inside the sheet: a link in one record to another. An element inside the
 * sheet is no place to return to — it closes with the sheet — so the opener
 * already held stands. Kept out of the component so the rule is assertable
 * (D20); `contains` is the one DOM call it needs.
 */
export function nextOpener<T>(
  current: T | null,
  candidate: T | null,
  sheet: { contains: (other: T) => boolean } | null,
): T | null {
  if (candidate === null) return current
  if (sheet !== null && sheet.contains(candidate)) return current
  return candidate
}
