import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { SnippetTag } from '@/data/vault'

/**
 * Every empty list names the control that emptied it. "No snippets here yet"
 * over a vault holding eight of them, because a chip above the list is set, is
 * the fastest way to make someone think the app lost their writing.
 */
export function snippetsEmptyState({
  total,
  query,
  tagFilter,
  selectedLabels,
  onNew,
  onClearQuery,
  onClearTag,
  onClearKeywords,
}: {
  /** How many snippets exist at all, before any filter. */
  total: number
  query: string
  tagFilter: SnippetTag | 'all'
  selectedLabels: ReadonlySet<string>
  onNew: () => void
  onClearQuery: () => void
  onClearTag: () => void
  onClearKeywords: () => void
}) {
  if (total === 0) {
    return {
      title: 'No snippets yet',
      description:
        'Save the paragraphs you keep rewriting — the bio, the why-this-department, the follow-up email.',
      action: (
        <Button size="sm" onClick={onNew}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          New snippet
        </Button>
      ),
    }
  }
  if (query.trim()) {
    return {
      title: 'Nothing matches that search',
      description: `No snippet mentions "${query.trim()}" in its name, text or kind.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearQuery}>
          Clear search
        </Button>
      ),
    }
  }
  const byTag = tagFilter !== 'all'
  const byKeyword = selectedLabels.size > 0

  if (byTag && byKeyword) {
    return {
      title: 'Nothing matches both filters',
      description: `No ${tagFilter} snippet carries the selected keywords.`,
      action: (
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            onClearTag()
            onClearKeywords()
          }}
        >
          Clear both filters
        </Button>
      ),
    }
  }
  if (byTag) {
    return {
      title: `No ${tagFilter} snippets`,
      description: `${total} snippets are filed under the other kinds.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearTag}>
          Show all kinds
        </Button>
      ),
    }
  }
  return {
    title: 'No snippets carry those keywords',
    description: 'The keyword filter at the top of the page is what is hiding them.',
    action: (
      <Button variant="outline" size="sm" onClick={onClearKeywords}>
        Clear keywords
      </Button>
    ),
  }
}
