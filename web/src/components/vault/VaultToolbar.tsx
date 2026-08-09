import { useId } from 'react'
import type { ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from '@/components/ui/input'

/**
 * One toolbar shape for all four Vault tools: `[filter] … [search] [Add]`.
 *
 * The tabs used to disagree about everything above the list. Reminders led with
 * a prose count and a segmented control on the right; Links opened with a
 * three-control form permanently expanded; Files and Snippets had a chip row and
 * an Add button. Switching tabs rebuilt the controls under the pointer, so the
 * button you were about to press became something else. The order is fixed here
 * so it cannot drift again.
 *
 * `filter` is optional because the Empty law says a filter that filters nothing
 * has no business being drawn — at zero records the tools pass nothing and let
 * the EmptyState carry the only action.
 */
export function VaultToolbar({
  filter,
  search,
  action,
}: {
  filter?: ReactNode
  search: ReactNode
  action: ReactNode
}) {
  return (
    /* Stacked below `sm`, side by side above it.

       On one row at phone widths the search group's `basis-64` claimed 256px of
       a ~350px toolbar, leaving the filter about 90px — and the chips inside it
       are `shrink-0`, so rather than compressing they overflowed their own flex
       item and painted underneath the search field. Giving each a full row of
       its own is the only arrangement where neither has to shrink below what it
       draws. */
    <div className="mb-3.5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
      {filter ? <div className="min-w-0 sm:flex-1">{filter}</div> : null}
      {/* Its own flex row so search and Add stay together and travel together
          when the filter chips push them onto a second line. */}
      <div className="flex min-w-0 items-center gap-2 sm:flex-1 sm:basis-64 sm:justify-end">
        {search}
        {action}
      </div>
    </div>
  )
}

/** The search box, same in every tool — including what Escape does to it. */
export function VaultSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  /** Names what is being searched, e.g. "Search reminders". */
  label: string
  placeholder: string
  value: string
  onChange: (next: string) => void
}) {
  const id = useId()

  return (
    <div className="relative min-w-0 flex-1 sm:max-w-56">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Search
        aria-hidden
        strokeWidth={1.8}
        className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-text-3"
      />
      <Input
        id={id}
        type="search"
        value={value}
        placeholder={placeholder}
        autoComplete="off"
        onChange={(event) => onChange(event.target.value)}
        // Escape empties the box rather than only blurring it. Safari and
        // Firefox draw no clear button on `type=search`, so without this the
        // only way back to the full list is to select the text and delete it.
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !value) return
          event.preventDefault()
          onChange('')
        }}
        className="pl-8"
      />
    </div>
  )
}

/**
 * Case- and accent-insensitive substring match across a record's fields.
 *
 * Normalised on both sides so "Andre" finds "André" — a job search collects
 * names typed by other people, and a filter that hides a row because of an
 * accent the user did not type reads as a missing record.
 */
export function matchesQuery(query: string, ...fields: (string | undefined)[]) {
  const needle = fold(query)
  if (!needle) return true
  return fields.some((field) => field && fold(field).includes(needle))
}

const fold = (text: string) =>
  text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
