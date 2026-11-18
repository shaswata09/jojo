/**
 * Where a search result for a Statistics card lands when the card is not drawn.
 *
 * This panel keeps its silence when there is nothing to compare, but the ⌘K
 * row for it is still offered, and landing on a page with nothing lit read as
 * a broken link. The headline rates are the panel right above it, and the
 * figures this one would cut a different way. A module function so
 * `useFocusArrival` can hold it as a stable dependency.
 */
export function statisticsFocusFallback(id: string): string | undefined {
  return id === 'stats-what-is-working' ? 'stats-headline' : undefined
}
