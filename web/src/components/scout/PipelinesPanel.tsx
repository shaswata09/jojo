import { Pencil, Plus, Radio, Trash2 } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { StatusDot } from '@/components/common/StatusDot'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { Pipeline } from '@/data/scout'

export function PipelinesPanel({
  pipelines,
  onlyActive,
  onShowAll,
  onNew,
  onEdit,
  onDelete,
  onToggle,
}: {
  /** Already filtered by the page option — the rows as they should render. */
  pipelines: readonly Pipeline[]
  onlyActive: boolean
  onShowAll: () => void
  onNew: () => void
  onEdit: (pipeline: Pipeline) => void
  onDelete: (pipeline: Pipeline) => void
  onToggle: (pipeline: Pipeline, enabled: boolean) => void
}) {
  return (
    <Panel>
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle className="mb-0" hint="run locally on a schedule">
          Pipelines
        </PanelTitle>
        {/* Was "kept for this visit — nothing is written to disk", beside
            pipelines that are nodes in the graph and survive a reload. What
            is still true of them is the half people ask about: they are
            written here, and nothing about them runs anywhere else. */}
        <p className="text-xs text-text-3">Saved in this browser — nothing runs off this machine</p>
      </div>

      {pipelines.length === 0 ? (
        <EmptyState
          icon={Radio}
          title={onlyActive ? 'Nothing switched on' : 'No pipelines'}
          description={
            onlyActive
              ? 'Every pipeline you have is switched off. Turn one on, or drop the filter in the page options.'
              : 'A pipeline is a saved search — a board to watch, the terms that matter, and how often to look.'
          }
          action={
            onlyActive ? (
              <Button size="sm" variant="outline" onClick={onShowAll}>
                Show all pipelines
              </Button>
            ) : (
              <Button size="sm" onClick={onNew}>
                <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                New pipeline
              </Button>
            )
          }
        />
      ) : (
        <RowList>
          {pipelines.map((p) => (
            <Row key={p.id} className="flex-wrap">
              <StatusDot status={p.enabled ? 'warn' : 'off'} className="mt-1.5" />
              <div className="min-w-0 flex-1 basis-64">
                <div>{p.name}</div>
                <div className="mt-0.5 truncate font-mono text-xs text-text-3">
                  {p.source} · {p.schedule} · {p.filter}
                </div>
              </div>
              <Chip tone={p.enabled ? 'amber' : 'gray'}>{p.enabled ? 'paused' : 'off'}</Chip>
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Edit ${p.name}`}
                aria-label={`Edit ${p.name}`}
                onClick={() => onEdit(p)}
              >
                <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={`Delete ${p.name}`}
                aria-label={`Delete ${p.name}`}
                onClick={() => onDelete(p)}
              >
                <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
              </Button>
              <Switch
                checked={p.enabled}
                onCheckedChange={(enabled) => onToggle(p, enabled)}
                aria-label={`Enable ${p.name}`}
              />
            </Row>
          ))}
        </RowList>
      )}
    </Panel>
  )
}
