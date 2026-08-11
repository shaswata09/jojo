import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { LinkCategory } from '@/data/vault'

/**
 * Every empty list names the control that emptied it. "No links yet" over a
 * vault holding eight of them, because a chip two rows up is set, is the
 * fastest way to make someone think the app lost their data.
 */
export function linksEmptyState({
  total,
  query,
  bucket,
  selectedLabels,
  addButton,
  onClearQuery,
  onClearBucket,
  onClearKeywords,
}: {
  /** How many links exist at all, before any filter. */
  total: number
  query: string
  bucket: LinkCategory | 'all'
  selectedLabels: ReadonlySet<string>
  /** The same Add button the toolbar carries — the only action at zero records. */
  addButton: ReactNode
  onClearQuery: () => void
  onClearBucket: () => void
  onClearKeywords: () => void
}) {
  if (total === 0) {
    return {
      title: 'No links saved yet',
      description:
        'Save a URL — a posting, a department page, a person you were told to contact. The title is read off the address.',
      action: addButton,
    }
  }
  if (query.trim()) {
    return {
      title: 'Nothing matches that search',
      description: `No link mentions "${query.trim()}" in its title, address, note or category.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearQuery}>
          Clear search
        </Button>
      ),
    }
  }
  const byCategory = bucket !== 'all'
  const byKeyword = selectedLabels.size > 0

  if (byCategory && byKeyword) {
    return {
      title: 'Nothing matches both filters',
      description: `No ${bucket} link carries the selected keywords.`,
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
  if (byCategory) {
    return {
      title: `No links under ${bucket}`,
      description: `${total} links are filed under the other categories.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearBucket}>
          Show all categories
        </Button>
      ),
    }
  }
  return {
    title: 'No links carry those keywords',
    description: 'The keyword filter at the top of the page is what is hiding them.',
    action: (
      <Button variant="outline" size="sm" onClick={onClearKeywords}>
        Clear keywords
      </Button>
    ),
  }
}
