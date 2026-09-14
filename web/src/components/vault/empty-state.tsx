import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'

/**
 * Every empty list names the control that emptied it.
 *
 * "No links yet" over a vault holding eight of them, because a chip two rows up
 * is set, is the fastest way to make someone think the app lost their data. So
 * each of the four vault tools answers the same five questions in the same
 * order: is there nothing at all, is a search on, are both the bucket chip and
 * the keyword row on, is just the bucket on, or is it just the keywords.
 *
 * That ladder used to be written out four times, once per tool, in four
 * `empty-state.tsx` files — `links/` and `files/` had byte-identical bodies
 * once the nouns were folded out. Four copies of a precedence order is four
 * chances for one list to start answering a different question from its
 * neighbours, and nobody reviewing one of them ever saw the other three. The
 * branching lives here now; the words stay at the call site, because a copy
 * edit starts at the list it is about.
 */
export type VaultEmptyState = {
  icon?: LucideIcon
  title: string
  description: string
  action: ReactNode
}

export type VaultEmptyCopy = {
  /** Used by every branch that does not name its own. */
  icon?: LucideIcon
  /** Nothing exists at all — the only branch that offers the Add control. */
  zero: { icon?: LucideIcon; title: string; description: string; action: ReactNode }
  /** Which fields the search looked at. `query` arrives trimmed. */
  search: (query: string) => string
  /** The bucket chip and the keyword row are both on. */
  both: string
  /** Only the bucket chip is on. `clearLabel` is the button that turns it off. */
  bucket: { icon?: LucideIcon; title: string; description: string; clearLabel: string }
  /**
   * Only the keyword row is on. Its clear button is always "Clear keywords",
   * and its description is `KEYWORDS_HID_THEM` in all four tools — the row is a
   * page-level control, so the sentence that points at it does not vary by
   * list. It stays overridable rather than hard-coded so a fifth tool with its
   * own keyword control is not forced to lie about where the switch is.
   */
  keywords: { title: string; description?: string }
  /**
   * A filter only one tool has, and only the Files list passes.
   *
   * Optional, and the branches below cannot fire without it: the other three
   * tools never set `filteredByUnfiled`, so their ladder is exactly the five
   * steps it was. `alone` is the message when it is the only thing on — which
   * is usually not a failure at all but the answer "everything is filed", and
   * saying "nothing here" to that would be misleading.
   */
  unfiled?: { alone: { title: string; description: string }; withOthers: string }
}

/** Where the keyword filter lives, said once. */
export const KEYWORDS_HID_THEM = 'The keyword filter at the top of the page is what is hiding them.'

export function emptyStateFor({
  total,
  query,
  filteredByBucket,
  filteredByKeyword,
  filteredByUnfiled = false,
  onClearQuery,
  onClearBucket,
  onClearKeywords,
  onClearUnfiled,
  copy,
}: {
  /** How many records exist at all, before any filter. */
  total: number
  query: string
  filteredByBucket: boolean
  filteredByKeyword: boolean
  /** The Files list's "Unfiled" chip. Absent everywhere else. */
  filteredByUnfiled?: boolean
  onClearQuery: () => void
  onClearBucket: () => void
  onClearKeywords: () => void
  onClearUnfiled?: () => void
  copy: VaultEmptyCopy
}): VaultEmptyState {
  if (total === 0) return { icon: copy.zero.icon ?? copy.icon, ...copy.zero }

  const trimmed = query.trim()
  if (trimmed) {
    return {
      icon: copy.icon,
      title: 'Nothing matches that search',
      description: copy.search(trimmed),
      action: (
        <Button variant="outline" size="sm" onClick={onClearQuery}>
          Clear search
        </Button>
      ),
    }
  }

  /*
   * Unfiled goes above the bucket and keyword branches because it is the most
   * specific thing on: a person who has just asked for loose documents and been
   * shown nothing is asking "are there none?", and the answer is about filing
   * rather than about whichever chip is also set.
   */
  if (filteredByUnfiled && copy.unfiled) {
    const alsoOthers = filteredByBucket || filteredByKeyword
    const clearAll = () => {
      onClearUnfiled?.()
      if (filteredByBucket) onClearBucket()
      if (filteredByKeyword) onClearKeywords()
    }
    return alsoOthers
      ? {
          icon: copy.icon,
          title: 'Nothing matches those filters',
          description: copy.unfiled.withOthers,
          action: (
            <Button variant="outline" size="sm" onClick={clearAll}>
              Clear filters
            </Button>
          ),
        }
      : {
          icon: copy.icon,
          ...copy.unfiled.alone,
          action: (
            <Button variant="outline" size="sm" onClick={() => onClearUnfiled?.()}>
              Show filed files too
            </Button>
          ),
        }
  }

  if (filteredByBucket && filteredByKeyword) {
    return {
      icon: copy.icon,
      title: 'Nothing matches both filters',
      description: copy.both,
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClearBucket()
            onClearKeywords()
          }}
        >
          Clear both filters
        </Button>
      ),
    }
  }

  if (filteredByBucket) {
    return {
      icon: copy.bucket.icon ?? copy.icon,
      title: copy.bucket.title,
      description: copy.bucket.description,
      action: (
        <Button variant="outline" size="sm" onClick={onClearBucket}>
          {copy.bucket.clearLabel}
        </Button>
      ),
    }
  }

  return {
    icon: copy.icon,
    title: copy.keywords.title,
    description: copy.keywords.description ?? KEYWORDS_HID_THEM,
    action: (
      <Button variant="outline" size="sm" onClick={onClearKeywords}>
        Clear keywords
      </Button>
    ),
  }
}
