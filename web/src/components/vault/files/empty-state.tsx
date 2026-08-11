import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import type { FileBucket } from '@/data/vault'

/**
 * Every empty list names the control that emptied it. "Nothing in this bucket"
 * over a vault holding ten files, because a keyword chip is set on the page
 * header, reads as data loss rather than as a filter.
 */
export function filesEmptyState({
  total,
  query,
  bucket,
  selectedLabels,
  addButton,
  onClearQuery,
  onClearBucket,
  onClearKeywords,
}: {
  /** How many files exist at all, before any filter. */
  total: number
  query: string
  bucket: FileBucket | 'all'
  selectedLabels: ReadonlySet<string>
  /** The same Add button the toolbar carries — the only action at zero records. */
  addButton: ReactNode
  onClearQuery: () => void
  onClearBucket: () => void
  onClearKeywords: () => void
}) {
  if (total === 0) {
    return {
      title: 'No files yet',
      description: 'Drop a posting, a paper or a draft here — or add one from your computer.',
      action: addButton,
    }
  }
  if (query.trim()) {
    return {
      title: 'Nothing matches that search',
      description: `No file mentions "${query.trim()}" in its name, note or bucket.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearQuery}>
          Clear search
        </Button>
      ),
    }
  }
  const byBucket = bucket !== 'all'
  const byKeyword = selectedLabels.size > 0

  if (byBucket && byKeyword) {
    return {
      title: 'Nothing matches both filters',
      description: `No file in ${bucket} carries the selected keywords.`,
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
  if (byBucket) {
    return {
      title: `Nothing in ${bucket}`,
      description: `${total} files are filed under the other buckets.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearBucket}>
          Show all buckets
        </Button>
      ),
    }
  }
  return {
    title: 'No files carry those keywords',
    description: 'The keyword filter at the top of the page is what is hiding them.',
    action: (
      <Button variant="outline" size="sm" onClick={onClearKeywords}>
        Clear keywords
      </Button>
    ),
  }
}
