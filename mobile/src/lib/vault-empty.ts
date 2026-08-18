import type { FeatherName } from '@/lib/timeline-visuals'

/**
 * Every empty list names the control that emptied it.
 *
 * "Nothing in this category" over a vault holding eight links, because a
 * keyword chip is lit or a word is in the search box, is the fastest way to
 * make someone think the app lost their data. Each of the four vault tools used
 * to answer one question — is the collection empty, yes or no — and then blame
 * the category whatever had actually hidden the rows. All three filters sit on
 * the same screen and the keyword row is FURTHER from the list than the
 * category chips are, so the wrong answer was the likely one.
 *
 * The five questions, in this order: is there nothing at all, is a search on,
 * are both the bucket chip and the keyword row on, is just the bucket on, or is
 * it just the keywords. Only the first offers the Add control — every other
 * branch offers the switch that would bring the rows back, because that is the
 * thing the reader wants and cannot find.
 *
 * The same ladder, in the same order, as `web/src/components/vault/empty-state.tsx`.
 * The branching is a rule about filters and the words are copy, so the words
 * stay at the call site: a copy edit starts at the list it is about.
 *
 * WHY IT RETURNS `clear` RATHER THAN A BUTTON. Web's version returns the
 * element. This one cannot: `vitest.config.mts` runs in node, importing a
 * `Button` pulls in React Native, and a five-branch precedence order that no
 * test can reach is how web's copy of this ladder came to have none. So the
 * branch says which switch to offer and what to call it, and the four call
 * sites — which are already rendering — draw it.
 */
export type VaultEmpty = {
  icon?: FeatherName
  title: string
  description: string
  /**
   * The switch that would bring the rows back, or `null` on the zero branch,
   * which is the only one where the right control is Add.
   */
  clear: { label: string; onPress: () => void } | null
}

export type VaultEmptyCopy = {
  /** Used by every branch that does not name its own. */
  icon?: FeatherName
  /** Nothing exists at all — the only branch where the caller's Add is offered. */
  zero: { icon?: FeatherName; title: string; description: string }
  /** Which fields the search looked at. `query` arrives trimmed. */
  search: (query: string) => string
  /** The bucket chip and the keyword row are both on. */
  both: string
  /** Only the bucket chip is on. `clearLabel` is the button that turns it off. */
  bucket: { icon?: FeatherName; title: string; description: string; clearLabel: string }
  /**
   * Only the keyword row is on. Its clear button is always "Clear keywords",
   * and its description is `KEYWORDS_HID_THEM` in all four tools — the keyword
   * row is a page-level control, so the sentence pointing at it does not vary
   * by list. Overridable rather than hard-coded so a fifth tool with its own
   * keyword control is not forced to lie about where the switch is.
   */
  keywords: { title: string; description?: string }
}

/** Where the keyword filter lives, said once. */
export const KEYWORDS_HID_THEM = 'The keyword filter above the list is what is hiding them.'

export function vaultEmptyState({
  total,
  query,
  filteredByBucket,
  filteredByKeyword,
  onClearQuery,
  onClearBucket,
  onClearKeywords,
  copy,
}: {
  /** How many records exist at all, before any filter. */
  total: number
  query: string
  filteredByBucket: boolean
  filteredByKeyword: boolean
  onClearQuery: () => void
  onClearBucket: () => void
  onClearKeywords: () => void
  copy: VaultEmptyCopy
}): VaultEmpty {
  if (total === 0) return { icon: copy.zero.icon ?? copy.icon, ...copy.zero, clear: null }

  const trimmed = query.trim()
  if (trimmed) {
    return {
      icon: copy.icon,
      title: 'Nothing matches that search',
      description: copy.search(trimmed),
      clear: { label: 'Clear search', onPress: onClearQuery },
    }
  }

  if (filteredByBucket && filteredByKeyword) {
    return {
      icon: copy.icon,
      title: 'Nothing matches both filters',
      description: copy.both,
      clear: {
        label: 'Clear both filters',
        onPress: () => {
          onClearBucket()
          onClearKeywords()
        },
      },
    }
  }

  if (filteredByBucket) {
    return {
      icon: copy.bucket.icon ?? copy.icon,
      title: copy.bucket.title,
      description: copy.bucket.description,
      clear: { label: copy.bucket.clearLabel, onPress: onClearBucket },
    }
  }

  return {
    icon: copy.icon,
    title: copy.keywords.title,
    description: copy.keywords.description ?? KEYWORDS_HID_THEM,
    clear: { label: 'Clear keywords', onPress: onClearKeywords },
  }
}
