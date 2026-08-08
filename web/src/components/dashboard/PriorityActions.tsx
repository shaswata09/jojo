import { Link } from 'react-router'
import { Carousel } from '@/components/common/Carousel'
import { Chip } from '@/components/common/Chip'
import { Button } from '@/components/ui/button'
import { priorityActions, type PriorityAction, type PriorityTone } from '@/data/priority'
import { cn } from '@/lib/utils'

const ring: Record<PriorityTone, string> = {
  green: 'border-success-border',
  red: 'border-danger-border',
  amber: 'border-warning-border',
  teal: 'border-accent-border',
}

const metricText: Record<PriorityTone, string> = {
  green: 'text-success',
  red: 'text-danger',
  amber: 'text-warning',
  teal: 'text-accent',
}

const chipTone: Record<PriorityTone, 'green' | 'red' | 'amber' | 'teal'> = {
  green: 'green',
  red: 'red',
  amber: 'amber',
  teal: 'teal',
}

function ActionCard({ action }: { action: PriorityAction }) {
  return (
    // h-full keeps every slide the same height, so the carousel doesn't
    // jolt as you move between cards of differing content length.
    <div
      className={cn(
        'surface flex h-full flex-col rounded-lg px-4 py-3.5 sm:px-5 sm:py-4',
        ring[action.tone],
      )}
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Chip tone={chipTone[action.tone]}>{action.kindLabel}</Chip>
            {action.role ? <Chip tone="teal">{action.role}</Chip> : null}
          </div>
          <h3 className="mt-1.5 text-base font-medium">{action.title}</h3>
          <p className="mt-1 text-xs text-text-3">{action.detail}</p>
        </div>

        <div className="shrink-0 text-right">
          <div className={cn('text-2xl leading-none font-semibold', metricText[action.tone])}>
            {action.metric.value}
          </div>
          <div className="mt-1 text-xs text-text-3">{action.metric.label}</div>
        </div>
      </div>

      {/* Full width, outside the header row — inside it the copy would be
          squeezed into the narrow column beside the metric. */}
      {/* Clamped: the copy is context, not the point of the card, and an
          unbounded paragraph was the single biggest contributor to its height. */}
      <p className="mt-2.5 line-clamp-2 text-sm text-text-2">{action.description}</p>

      <ul className="mt-2.5 flex flex-wrap gap-1.5">
        {action.tags.map((tag) => (
          <li key={tag}>
            <Chip shape="capsule" tone="gray">
              {tag}
            </Chip>
          </li>
        ))}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-hairline pt-3 text-sm">
        {action.facts.map((f) => (
          <div key={f.label}>
            <dt className="text-xs text-text-3">{f.label}</dt>
            <dd className="mt-0.5 truncate font-mono text-text-1">{f.value}</dd>
          </div>
        ))}
      </dl>

      {/* mt-auto pins actions to the bottom regardless of card content. */}
      <div className="mt-auto flex flex-wrap gap-2 pt-3">
        {action.actions.map((a) =>
          a.to ? (
            <Button key={a.label} variant="ghost" size="sm" asChild>
              <Link to={a.to}>{a.label}</Link>
            </Button>
          ) : (
            <Button key={a.label} size="sm" variant={a.primary ? 'default' : 'ghost'}>
              {a.label}
            </Button>
          ),
        )}
      </div>
    </div>
  )
}

export function PriorityActions() {
  if (priorityActions.length === 0) return null

  return (
    <Carousel label="Priority actions" className="min-w-0">
      {priorityActions.map((action) => (
        <ActionCard key={action.id} action={action} />
      ))}
    </Carousel>
  )
}
