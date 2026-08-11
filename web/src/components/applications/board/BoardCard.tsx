import type { Ref } from 'react'
import { Link } from 'react-router'
import { useDraggable, type DraggableAttributes } from '@dnd-kit/core'
import { Flag, GripVertical } from 'lucide-react'
import { openRail } from '@/components/applications/open-rail'
import { STAGE_LABEL, StageMenu } from '@/components/applications/StageMenu'
import { Chip } from '@/components/common/Chip'
import { LabelChips } from '@/components/common/LabelPicker'
import { displayName, type Application, type Stage } from '@/data/seed'
import { refKey } from '@/lib/ids'
import { appPath } from '@/lib/links'
import { cn } from '@/lib/utils'

/**
 * The card itself, with no drag wiring.
 *
 * Shared by the card sitting in its column and by the copy rendered in the drag
 * overlay, so the thing you pick up is near enough identical to the thing you
 * put down. The overlay copy passes no `handle` and no `onMoveStage`: it is a
 * picture of a card in transit, and a live popover trigger inside it would be a
 * focusable control the user cannot reach.
 */
export function BoardCardBody({
  app,
  handle,
  onMoveStage,
  open,
  lifted,
  className,
  ref,
}: {
  app: Application
  /** Grip props from useDraggable. Omitted for the overlay copy, which is inert. */
  handle?: {
    attributes: DraggableAttributes
    listeners: ReturnType<typeof useDraggable>['listeners']
  }
  onMoveStage?: (a: Application, stage: Stage) => void
  /** True when this record is the one showing in the detail sheet. */
  open?: boolean
  /** Raises the card off the board while it is being carried. */
  lifted?: boolean
  className?: string
  ref?: Ref<HTMLDivElement>
}) {
  return (
    // `relative`, because the title's link stretches across the whole card.
    // The left padding is the grip's gutter: the grip is positioned out of the
    // flow so the title starts at the same x as the chips under it.
    <div
      ref={ref}
      className={cn(
        'surface group relative rounded-md py-2.5 pr-2.5 pl-5',
        open && openRail,
        className,
      )}
      // Inline, not `shadow-[…]`: `.surface` sets box-shadow from the same
      // cascade layer Tailwind emits utilities into, and wins by source order —
      // which is why the drag overlay used to travel with no lift at all.
      style={lifted ? { boxShadow: 'var(--shadow-raised)' } : undefined}
    >
      <button
        type="button"
        // The overlay copy is decorative; the real one is the drag handle.
        tabIndex={handle ? undefined : -1}
        aria-hidden={handle ? undefined : true}
        className={cn(
          // z-[1] lifts the grip over the stretched link. Without it the link
          // covers the handle and a drag becomes a navigation — which is the
          // click-versus-drag fight, settled by stacking order rather than by
          // stopping propagation between two controls that now never overlap.
          // `touch-target` is what gives this a 44px catch area under a finger.
          // It is drawn at 18×18 and carries no size class, so neither branch of
          // the coarse-pointer rule in `index.css` could reach it — the board's
          // core gesture was the smallest target on the page.
          'touch-target absolute top-1/2 left-0.5 z-[1] -translate-y-1/2 cursor-grab touch-none rounded-sm p-0.5 text-text-3 transition-opacity active:cursor-grabbing',
          // It was `opacity-0` until hover: the board's core gesture had no
          // visible affordance at all, and on touch there is no hover to
          // reveal it with.
          handle ? 'opacity-40 group-hover:opacity-100 focus-visible:opacity-100' : 'opacity-100',
        )}
        aria-label={handle ? `Move ${displayName(app)} to another stage` : undefined}
        title={handle ? 'Drag to another stage' : undefined}
        {...handle?.attributes}
        {...handle?.listeners}
      >
        <GripVertical className="size-3.5" aria-hidden />
      </button>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* One accessible name, one hit area the size of the card. The
              alternative — wrapping the card in an anchor — puts a button and a
              set of chips inside a link, which is invalid and makes the grip
              draggable as a link rather than as a card. The overlay copy is not
              a link: it is a picture of the card being carried. */}
          {handle ? (
            <Link
              to={appPath(app)}
              draggable={false}
              aria-current={open ? 'page' : undefined}
              className="block truncate text-sm font-semibold after:absolute after:inset-0 after:content-[''] hover:text-accent"
            >
              {displayName(app)}
            </Link>
          ) : (
            <div className="truncate text-sm font-semibold">{displayName(app)}</div>
          )}
          <div className="mt-0.5 text-xs text-text-3">{app.note}</div>
        </div>
        {app.flagged ? (
          <Flag
            className="mt-0.5 size-3.5 shrink-0 text-danger"
            strokeWidth={1.9}
            aria-label="Flagged for follow-up"
          />
        ) : null}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        {/* The board's only stage control that a finger or a keyboard can
            operate. Dragging with the keyboard is Space plus twenty arrow
            presses to cross two columns; this is two. */}
        {onMoveStage ? (
          <StageMenu
            value={app.stage}
            onSelect={(stage) => onMoveStage(app, stage)}
            className="relative z-[1]"
          />
        ) : (
          <Chip stage={app.stage} className="font-normal">
            {STAGE_LABEL[app.stage]}
          </Chip>
        )}
        {/* Neutral, per colour law: the role is a category, not a status, and
            the only coloured pills on a record are the keywords the user chose
            themselves. */}
        <Chip size="sm" className="font-normal">
          {app.roleTag}
        </Chip>
        {/* Applications are keyed `app:<id>` in the label store while timeline
            items and vault records use the bare id — the asymmetry is in the
            seed, see data/labels.ts. Capsules rather than the squared `Chip`
            beside them, so a keyword you chose reads apart from the fixed tags
            the app assigns. */}
        <LabelChips recordId={refKey('app', app.id)} />
      </div>
    </div>
  )
}

/**
 * A card in its column.
 *
 * It no longer moves with the pointer — DragOverlay does that. The card used to
 * carry the drag transform itself, which meant it was still a child of the
 * column's `overflow-y-auto` list and got clipped the moment it left that box.
 * No z-index fixes an overflow clip; the element has to leave the container
 * entirely, which is exactly what the overlay is for. What stays behind is a
 * dimmed placeholder holding the slot open.
 */
export function BoardCard({
  app,
  onMoveStage,
  open,
  ref,
}: {
  app: Application
  onMoveStage: (a: Application, stage: Stage) => void
  open?: boolean
  ref?: Ref<HTMLDivElement>
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: app.id })

  return (
    <div ref={setNodeRef}>
      <BoardCardBody
        ref={ref}
        app={app}
        handle={{ attributes, listeners }}
        onMoveStage={onMoveStage}
        open={open}
        className={isDragging ? 'opacity-35' : undefined}
      />
    </div>
  )
}
