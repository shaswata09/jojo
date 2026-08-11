import { useState } from 'react'
import type { Ref } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { BoardCardBody } from '@/components/applications/board/BoardCard'
import { BoardColumn } from '@/components/applications/board/BoardColumn'
import { PanelScroll } from '@/components/common/Panel'
import { STAGES, type Application, type Stage } from '@/data/seed'
import { cn } from '@/lib/utils'

/**
 * The six stages, side by side, and the drag that moves a record between them.
 *
 * Draws from the same filtered pool as the table. The board used to read
 * straight from every record, so a search that emptied the table left the board
 * showing everything and no sign that a filter was on at all.
 */
export function ApplicationsBoard({
  apps,
  onAdd,
  onMoveStage,
  openId,
  openRef,
  reducedMotion,
}: {
  /** The page's filtered pool, grouped into columns here rather than upstream. */
  apps: Application[]
  onAdd: (stage: Stage) => void
  onMoveStage: (a: Application, stage: Stage) => void
  openId?: string
  openRef: Ref<HTMLDivElement>
  reducedMotion: boolean
}) {
  /** The card currently in the pointer's hand, rendered in the overlay. */
  const [activeId, setActiveId] = useState<string | null>(null)

  const sensors = useSensors(
    // A small activation distance so a click on the handle isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )

  const activeCard = activeId ? apps.find((a) => a.id === activeId) : undefined

  const onDragStart = (event: DragStartEvent) => setActiveId(String(event.active.id))

  const onDragEnd = (event: DragEndEvent) => {
    setActiveId(null)
    const stage = event.over?.id as Stage | undefined
    const app = apps.find((a) => a.id === String(event.active.id))
    // Through the same call as the stage pill and the table chip, so the drag
    // gets the toast and the undo it never had. A mis-drop is the likeliest
    // slip on this page and it used to be the only one with no way back.
    if (stage && app) onMoveStage(app, stage)
  }

  return (
    // The two-line paragraph explaining the drag to a mouse and a
    // keyboard is gone: the grip is visible now and every card carries
    // a stage menu, so the gesture explains itself and the alternative
    // is a control rather than a sentence.
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <PanelScroll axis="x" className="flex gap-3">
        {STAGES.map((stage) => (
          <BoardColumn
            key={stage.id}
            stage={stage}
            items={apps.filter((a) => a.stage === stage.id)}
            onAdd={onAdd}
            onMoveStage={onMoveStage}
            openId={openId}
            openRef={openRef}
          />
        ))}
      </PanelScroll>

      {/* Rendered outside every column, so it is clipped by nothing and
          stays above the board while it travels. `dropAnimation={null}`
          because the ghost used to fly to the card's *old* position and
          hover there, misaligned, for 180ms after the drop — the one
          moment the user is checking whether the move took.

          dnd-kit builds this overlay with the Web Animations API on a
          cloned node, which is exactly what the `*` reset in index.css
          cannot reach — hence the hook rather than a CSS rule. The
          scale goes with it: under reduced motion the card being
          carried is already distinguished by its shadow and its cursor,
          and a card that changes size on pick-up is the movement the
          preference is asking us not to make. */}
      <DragOverlay dropAnimation={null}>
        {activeCard ? (
          <BoardCardBody
            app={activeCard}
            lifted
            className={cn('w-[224px] cursor-grabbing', !reducedMotion && 'scale-[1.03]')}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  )
}
