/**
 * Case- and accent-insensitive substring match across a record's fields.
 *
 * Normalised on both sides so "Andre" finds "André" — a job search collects
 * names typed by other people, and a filter that hides a row because of an
 * accent the user did not type reads as a missing record.
 *
 * Every list that filters by typing goes through this: the four Vault tools,
 * the applications list and the search screen. They were each doing their own
 * `.toLowerCase().includes()`, which meant six lists and one of them treating
 * "Muñoz" as unfindable.
 */
export function matchesQuery(query: string, ...fields: (string | undefined | null)[]) {
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
