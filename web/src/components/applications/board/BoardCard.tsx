import type { Ref } from 'react'
import { Link } from 'react-router'
import { useDraggable, type DraggableAttributes } from '@dnd-kit/core'
import { Flag } from 'lucide-react'
import { openRail } from '@/components/applications/open-rail'
import { StageMenu } from '@/components/applications/StageMenu'
import { Chip } from '@/components/common/Chip'
import { LabelChips } from '@/components/common/LabelPicker'
import { STAGE_LABEL, displayName, type Application, type Stage } from '@/data/seed'
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
    // The left padding is the drag rail's gutter: the rail is positioned out of
    // the flow, so the title starts at the same x as the chips under it.
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
          // A RAIL DOWN THE WHOLE LEFT EDGE, rather than a grip pinned at one
          // point. It was an 18x18 icon centred vertically, which on a card of
          // any height left six dots floating beside the middle of the text
          // with nothing to say they belonged to the card rather than to the
          // line they happened to sit next to. Full height makes the affordance
          // the shape of the thing it moves, and gives a finger the card's own
          // height to land on instead of 18px of it.
          //
          // z-[1] lifts it over the stretched link. Without it the link covers
          // the handle and a drag becomes a navigation — the click-versus-drag
          // fight, settled by stacking order rather than by stopping
          // propagation between two controls that now never overlap.
          //
          // `touch-target` still earns its place at full height: the rail is
          // 20px WIDE, under the 24px WCAG 2.5.8 minimum for any pointer, and
          // the rule's centred pseudo-element widens the catch area without
          // costing the layout a pixel.
          //
          // No background, deliberately. `openRail` marks the open record with
          // a 3px accent bar at this same left edge, and anything painted here
          // would cover it.
          'touch-target absolute inset-y-0 left-0 z-[1] w-5 cursor-grab touch-none rounded-l-md py-1.5 text-text-3 transition-opacity active:cursor-grabbing',
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
        {/* Two columns of dots repeated down the rail, as a background rather
            than a stack of icons: one paint step fits any card height, and the
            4px grid is the spacing `GripVertical` drew at, so the texture is
            the one this card always had — just continued to both ends.
            `w-2` centred in the 20px rail leaves the leftmost few pixels to the
            open-record accent bar. */}
        <span
          className="mx-auto block h-full w-2 bg-[radial-gradient(currentColor_1px,transparent_1.5px)] bg-[length:4px_4px]"
          aria-hidden
        />
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
          {/*
            * No note here, and that is a size decision rather than a tidiness
            * one.
            *
            * It was printed unclamped, so a card was as tall as whatever
            * somebody had typed into the record — a paragraph about a phone
            * screen turned one card into six lines and pushed the rest of its
            * column off the screen. A board is a shape you read at a glance:
            * every card the same height, and how many are in each stage
            * legible without scrolling. One long note costs that for the whole
            * column.
            *
            * Clamping it to a line was the other option and is what the table
            * does. On a 224px card a line of a note is about four words, which
            * is not a note — it is a ragged grey strip that makes every card
            * taller to say nothing. The table has the room for it and the
            * switch to turn it off; the record itself has all of it; search
            * reads it either way (`list-query.ts`). Nothing here is lost, and
            * the cards go back to one height.
            */}
        </div>
        {/* Amber, not red: red is this app's word for past due, so a flag the
            user set themselves read as a missed date, and the icon fought the
            amber sidebar badge that counts it (BADGE_TONE in SidebarNav.tsx). */}
        {app.flagged ? (
          <Flag
            className="mt-0.5 size-3.5 shrink-0 text-warning"
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
