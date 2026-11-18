import type { Ref } from 'react'
import { useDroppable } from '@dnd-kit/core'
import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { BoardCard } from '@/components/applications/board/BoardCard'
import { PanelScroll } from '@/components/common/Panel'
import { ShowMoreRows } from '@/components/common/ShowMoreRows'
import { indexOfId, useRowCap } from '@/components/common/use-row-cap'
import type { STAGES, Application, Stage } from '@/data/seed'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

export function BoardColumn({
  stage,
  items,
  onAdd,
  onMoveStage,
  openId,
  dropped,
  keep,
  openRef,
}: {
  stage: (typeof STAGES)[number]
  items: Application[]
  onAdd: (stage: Stage) => void
  onMoveStage: (a: Application, stage: Stage) => void
  openId?: string
  /** The card last moved to another column: mounted however far down it sorts. */
  dropped?: string
  /** The list's search and filters, carried on each card's link (`listStateOf`). */
  keep: string
  openRef: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation('applications')
  const domain = useDomain()
  const { setNodeRef, isOver } = useDroppable({ id: stage.id })
  /*
   * A page of cards per column, like the table and the phone board. Every card
   * was mounted, each with its drag hook and stage menu: 3,000 applications
   * were 39,457 DOM nodes and 1.4-1.8 s long tasks on load and on drag start
   * (finding performance-1). The open record and the card just moved here stay
   * mounted however far down they sort — the cap is raised to reach them, and
   * stays raised (`useRowCap`), so closing the sheet does not unmount the card
   * focus is about to return to.
   */
  const cap = useRowCap(items.length, Math.max(indexOfId(items, openId), indexOfId(items, dropped)))

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'flex w-[240px] shrink-0 flex-col rounded-lg border p-2 transition-colors',
        // Mirrors the calendar's day cell: the target lifts to the card colour
        // and takes the accent border, so the column you are about to drop into
        // is the brightest thing on the board. It painted nothing at all until
        // --accent-soft stopped being an alias of --well.
        isOver ? 'border-accent bg-panel' : 'border-hairline bg-well',
      )}
    >
      <div className="flex items-center gap-2 px-1 pb-2">
        <span className={cn('size-1.5 rounded-full', stage.dot)} aria-hidden />
        {/* h2, not h3: the page h1 is "Applications" and there is no heading
            between it and these, so h3 skipped a level and the board read as a
            gap in the outline to anyone navigating by heading. Size is a class,
            not the tag. */}
        <h2 className="min-w-0 truncate text-xs font-medium text-text-2">
          {domain.stage(stage.id)}
        </h2>
        <span className="tabular ms-auto rounded-sm border border-hairline bg-panel px-1.5 text-xs text-text-3">
          {items.length}
        </span>
      </div>

      {/* The column is as tall as the board; only the cards scroll, so every
          stage header stays visible however uneven the stages are. `tight`
          because the column's gutter is p-2, not a Panel's. */}
      <PanelScroll axis="y" inset="tight" className="flex min-h-16 flex-col gap-2">
        {items.slice(0, cap.shown).map((app) => (
          <BoardCard
            key={app.id}
            app={app}
            onMoveStage={onMoveStage}
            open={app.id === openId}
            keep={keep}
            ref={app.id === openId ? openRef : undefined}
          />
        ))}
        <ShowMoreRows shown={cap.shown} hidden={cap.hidden} onMore={cap.more} />

        {/* Where the card will land. The column tint alone says "this one" but
            not "and it goes here", which is the half people read as the drag
            having done nothing.

            A zero-height element still eats the list's `gap-2`, so the closed
            state cancels that gap with a negative margin — otherwise every
            column carries 8px of dead space forever. */}
        <div
          aria-hidden
          className={cn(
            'shrink-0 overflow-hidden rounded-md border border-dashed border-accent-border bg-accent-soft transition-all duration-200 ease-out',
            isOver ? 'mt-0 h-[84px] opacity-100' : '-mt-2 h-0 opacity-0',
          )}
        />

        {/* Per column, so the stage is already chosen: logging a job you have
            already interviewed for should not mean adding it as a draft and
            then dragging it four columns to the right. */}
        <button
          type="button"
          onClick={() => onAdd(stage.id)}
          className="flex w-full shrink-0 cursor-pointer items-center justify-center gap-1 rounded-md border border-dashed border-hairline-strong py-1.5 text-xs text-text-3 transition-colors hover:border-accent-border hover:bg-panel hover:text-text-1"
        >
          <Plus className="size-3" strokeWidth={2} aria-hidden />
          {t('board.addHere')}
        </button>
      </PanelScroll>
    </div>
  )
}
