import { Bot, Pencil, Play, Plus, Radio, Trash2 } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { StatusDot } from '@/components/common/StatusDot'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isAuto, kindOf } from '@jojo/service/react/use-pipelines'
import { AUTO_CAPABLE } from '@jojo/service/core/proposal'
import type { Pipeline } from '@/data/scout'

const KIND_LABEL = { twin: 'Digital twin', scout: 'Job scout' } as const

/**
 * What each row's chip says, and it is now a claim about the world.
 *
 * It used to read "paused" for an ENABLED pipeline and "off" for a disabled
 * one, which was accurate while nothing ran and is a lie now that something
 * does. The four states below are the four things that are actually true, and
 * "paused" has moved to the one case that still deserves it: switched on, with
 * no model to run it.
 */
function statusOf(p: Pipeline, running: boolean, paused: boolean) {
  if (!p.enabled) return { label: 'off', tone: 'gray' as const, dot: 'off' as const }
  if (paused) return { label: 'paused', tone: 'amber' as const, dot: 'warn' as const }
  if (running) return { label: 'running', tone: 'teal' as const, dot: 'on' as const }
  return { label: 'watching', tone: 'green' as const, dot: 'on' as const }
}

export function PipelinesPanel({
  pipelines,
  onlyActive,
  running,
  activity,
  paused,
  pendingCount,
  onShowAll,
  onNew,
  onEdit,
  onDelete,
  onToggle,
  onSetAuto,
  onRunNow,
}: {
  /** Already filtered by the page option — the rows as they should render. */
  pipelines: readonly Pipeline[]
  onlyActive: boolean
  /** The id of the pipeline mid-round, if any. At most one runs at a time. */
  running: string | null
  /** What the running pipeline last said it was doing. */
  activity: string | null
  /** No model is reachable, so nothing can run. */
  paused: boolean
  pendingCount: (pipelineId: string) => number
  onShowAll: () => void
  onNew: () => void
  onEdit: (pipeline: Pipeline) => void
  onDelete: (pipeline: Pipeline) => void
  onToggle: (pipeline: Pipeline, enabled: boolean) => void
  onSetAuto: (pipeline: Pipeline, auto: boolean) => void
  onRunNow: (pipelineId: string) => void
}) {
  return (
    <Panel>
      <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
        <PanelTitle className="mb-0" hint="run on this device while jojo is open">
          Pipelines
        </PanelTitle>
        {/* The honest sentence, and the one people ask about. A pipeline cannot
            run with the app closed on either platform — no service worker on
            the web, no background task on the phone — so the caption says when
            they run rather than implying a daemon. */}
        <p className="text-xs text-text-3">
          They work while this tab is open — nothing runs off this machine
        </p>
      </div>

      {pipelines.length === 0 ? (
        <EmptyState
          icon={Radio}
          title={onlyActive ? 'Nothing switched on' : 'No pipelines'}
          description={
            onlyActive
              ? 'Every pipeline you have is switched off. Turn one on, or drop the filter in the page options.'
              : 'A pipeline is a standing job for the assistant: keeping your records complete, or watching for postings worth your attention.'
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
          {pipelines.map((p) => {
            const isRunning = running === p.id
            const state = statusOf(p, isRunning, paused)
            const pending = pendingCount(p.id)
            const kind = kindOf(p)

            return (
              <Row key={p.id} className="flex-wrap">
                <StatusDot status={state.dot} className="mt-1.5" />
                <div className="min-w-0 flex-1 basis-64">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>{p.name}</span>
                    <Chip tone="gray" size="sm">
                      {KIND_LABEL[kind]}
                    </Chip>
                    {isAuto(p) ? (
                      <Chip tone="amber" size="sm">
                        <Bot className="size-3" strokeWidth={1.8} aria-hidden />
                        auto
                      </Chip>
                    ) : null}
                  </div>
                  {/* While it is running, the model's own narration replaces the
                      static configuration line — during the one moment the row
                      could say something specific, saying "daily · —" is a
                      waste of the only line there is. */}
                  <div className="mt-0.5 truncate font-mono text-xs text-text-3">
                    {isRunning && activity ? activity : `${p.source} · ${p.schedule} · ${p.filter}`}
                  </div>
                </div>

                {pending > 0 ? (
                  <Chip tone="teal">
                    {pending} to review
                  </Chip>
                ) : null}
                <Chip tone={state.tone}>{state.label}</Chip>

                {/* Auto is offered only where it exists. A scout never runs
                    unattended — see AUTO_CAPABLE — so rendering a disabled
                    switch would be advertising a setting that is not coming. */}
                {AUTO_CAPABLE[kind] ? (
                  <label className="flex items-center gap-1.5 text-xs text-text-3">
                    <span>auto</span>
                    <Switch
                      checked={isAuto(p)}
                      onCheckedChange={(auto) => onSetAuto(p, auto)}
                      aria-label={`Run ${p.name} without asking`}
                    />
                  </label>
                ) : null}

                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={`Run ${p.name} now`}
                  aria-label={`Run ${p.name} now`}
                  disabled={paused || running !== null}
                  onClick={() => onRunNow(p.id)}
                >
                  <Play className="size-3.5" strokeWidth={1.8} aria-hidden />
                </Button>
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
            )
          })}
        </RowList>
      )}
    </Panel>
  )
}
