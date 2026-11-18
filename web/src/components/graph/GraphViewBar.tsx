import { useId } from 'react'
import { ArrowLeft, ChevronRight, Crosshair, Expand, Shrink } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { GROUP_DIMENSIONS } from '@/lib/graph/view'
import type { GroupDimension } from '@/lib/graph/view'

export type GraphMode = 'overview' | 'focus' | 'free'

const SELECT_CLASS =
  'h-8 cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

/**
 * The strip above the canvas: which picture (Overview, Focus, Free layout),
 * what the overview groups by, and in focus the trail of records focused on.
 *
 * The free layout is offered only while it can draw the whole graph — past
 * `MAX_DRAWN` it would silently drop records, which is the picture this
 * redesign exists to replace.
 */
export function GraphViewBar({
  mode,
  onMode,
  freeAllowed,
  by,
  onBy,
  trail,
  labelOf,
  onCrumb,
  onBack,
  action,
}: {
  mode: GraphMode
  onMode: (mode: GraphMode) => void
  freeAllowed: boolean
  by: GroupDimension
  onBy: (by: GroupDimension) => void
  /** Focused records, oldest first; the last is at the centre. */
  trail: readonly string[]
  labelOf: (id: string) => string
  onCrumb: (index: number) => void
  onBack: () => void
  /** What the selected record can do here, when anything is selected. */
  action: {
    label: string
    canFocus: boolean
    onFocus: () => void
    /** Only in focus, for a record that is not the centre. */
    expand?: { expanded: boolean; onToggle: () => void }
  } | null
}) {
  const { t } = useTranslation('graph')
  const groupId = useId()

  const modes: { value: GraphMode; label: string }[] = [
    { value: 'overview', label: t('view.mode.overview') },
    { value: 'focus', label: t('view.mode.focus') },
    ...(freeAllowed ? [{ value: 'free' as const, label: t('view.mode.free') }] : []),
  ]

  return (
    <div className="mb-3 flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Segment label={t('view.mode.label')} value={mode} onChange={onMode} options={modes} />

        {mode === 'overview' ? (
          <div className="flex items-center gap-2">
            <label htmlFor={groupId} className="text-xs text-text-3">
              {t('view.groupBy.label')}
            </label>
            <select
              id={groupId}
              className={SELECT_CLASS}
              value={by}
              onChange={(event) => onBy(event.target.value as GroupDimension)}
            >
              {GROUP_DIMENSIONS.map((dimension) => (
                <option key={dimension} value={dimension}>
                  {t(`view.groupBy.${dimension}`)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {action ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5 sm:ms-auto">
            {action.canFocus ? (
              <Button
                variant="outline"
                size="sm"
                onClick={action.onFocus}
                title={t('view.focusOnHint')}
                aria-label={t('view.focusOn', { label: action.label })}
                className="max-w-full"
              >
                <Crosshair className="size-3.5" strokeWidth={2} aria-hidden />
                <span className="truncate">{t('view.focusOn', { label: action.label })}</span>
              </Button>
            ) : null}
            {action.expand ? (
              <Button
                variant="outline"
                size="sm"
                onClick={action.expand.onToggle}
                aria-pressed={action.expand.expanded}
                title={t('view.expandHint')}
              >
                {action.expand.expanded ? (
                  <Shrink className="size-3.5" strokeWidth={2} aria-hidden />
                ) : (
                  <Expand className="size-3.5" strokeWidth={2} aria-hidden />
                )}
                {action.expand.expanded ? t('view.collapse') : t('view.expand')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === 'focus' && trail.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onBack}>
            <ArrowLeft className="size-3.5 rtl:-scale-x-100" strokeWidth={2} aria-hidden />
            {t('view.back')}
          </Button>
          <nav aria-label={t('view.trail')} className="min-w-0">
            <ol className="flex flex-wrap items-center gap-1 text-xs">
              {trail.map((id, index) => {
                const last = index === trail.length - 1
                return (
                  <li key={`${id}-${index}`} className="flex min-w-0 items-center gap-1">
                    {index > 0 ? (
                      <ChevronRight
                        className="size-3 shrink-0 text-text-3 rtl:-scale-x-100"
                        aria-hidden
                      />
                    ) : null}
                    {last ? (
                      <span
                        aria-current="location"
                        className="max-w-[16rem] truncate font-medium text-text-1"
                      >
                        {labelOf(id)}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onCrumb(index)}
                        className="max-w-[12rem] cursor-pointer truncate rounded-sm text-text-2 underline-offset-2 hover:text-text-1 hover:underline"
                      >
                        {labelOf(id)}
                      </button>
                    )}
                  </li>
                )
              })}
            </ol>
          </nav>
        </div>
      ) : null}
    </div>
  )
}
