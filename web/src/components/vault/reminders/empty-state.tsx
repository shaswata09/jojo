import { BellRing, Check, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { BUCKET_LABEL } from '@/components/vault/reminders/model'
import type { TimelineBucket } from '@/data/timeline'

/**
 * Every empty list names the control that emptied it. "All caught up" over a
 * vault holding eight open reminders, because a chip or a search box is set,
 * congratulates someone for work they have not done.
 */
export function remindersEmptyState({
  total,
  query,
  bucket,
  selectedLabels,
  onAdd,
  onClearQuery,
  onClearBucket,
  onClearKeywords,
}: {
  /** How many reminders exist at all, before any filter. */
  total: number
  query: string
  bucket: TimelineBucket | 'all'
  selectedLabels: ReadonlySet<string>
  onAdd: () => void
  onClearQuery: () => void
  onClearBucket: () => void
  onClearKeywords: () => void
}) {
  if (total === 0) {
    return {
      icon: BellRing,
      title: 'No reminders yet',
      description:
        'A reminder is a dated nudge — chase a referee, check a portal, send a thank-you. Ones you mark as follow-ups also show on the dashboard until you tick them off.',
      action: (
        <Button size="sm" onClick={onAdd}>
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          Add reminder
        </Button>
      ),
    }
  }
  if (query.trim()) {
    return {
      icon: BellRing,
      title: 'Nothing matches that search',
      description: `No reminder mentions "${query.trim()}" in its title, note, kind or application.`,
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
      icon: BellRing,
      title: 'Nothing matches both filters',
      description: `No ${BUCKET_LABEL[bucket].toLowerCase()} reminder carries the selected keywords.`,
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
      icon: bucket === 'done' ? Check : BellRing,
      title:
        bucket === 'done'
          ? 'Nothing completed yet'
          : `Nothing ${BUCKET_LABEL[bucket].toLowerCase()}`,
      description:
        bucket === 'done'
          ? 'Reminders you tick off collect here, so one ticked by mistake is still findable.'
          : `${total} reminders are filed under the other groups.`,
      action: (
        <Button variant="outline" size="sm" onClick={onClearBucket}>
          Show all reminders
        </Button>
      ),
    }
  }
  return {
    icon: BellRing,
    title: 'No reminders carry those keywords',
    description: 'The keyword filter at the top of the page is what is hiding them.',
    action: (
      <Button variant="outline" size="sm" onClick={onClearKeywords}>
        Clear keywords
      </Button>
    ),
  }
}
