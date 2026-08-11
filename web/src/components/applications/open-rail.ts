/**
 * The one marker for "this is the record open beside the list".
 *
 * A left rail rather than a background tint: `.surface` sets `background` in the
 * same cascade layer Tailwind emits utilities into, so `bg-accent-soft` on a
 * board card silently loses. A pseudo-element owes nothing to that fight.
 *
 * Lives on its own because both views draw it — the board card and the table's
 * row header — and a copy in each would drift the moment one of them moved.
 */
export const openRail =
  'before:absolute before:inset-y-1.5 before:left-0 before:w-[3px] before:rounded-r-full before:bg-accent before:content-[""]'
