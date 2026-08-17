import { useRef, useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowLeft,
  ArrowRightLeft,
  Copy,
  Flag,
  MoreHorizontal,
  PenLine,
  Pencil,
  Trash2,
  X,
} from 'lucide-react'
import { plural } from '@/components/common/text'
import { StageMenu } from '@/components/applications/StageMenu'
import { Chip } from '@/components/common/Chip'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { Panel } from '@/components/common/Panel'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { menuItemClass } from '@/components/common/RowMenu'
import { displayName } from '@/data/seed'
import type { Application, Stage } from '@/data/seed'
import { useApplications } from '@/kg/react/use-applications'
import { refKey } from '@/lib/ids'
import { applicationsPath } from '@/lib/links'
import { DESKTOP_QUERY, useMediaQuery } from '@/lib/use-media-query'
import { cn } from '@/lib/utils'

/**
 * The shared popover item, plus the disabled state only this menu has.
 *
 * Extended with `cn()` rather than retyped: the hand-written copy this replaces
 * had drifted a token — it was missing `cursor-pointer`, so the detail page's ⋯
 * showed an arrow where the vault's showed a hand.
 */
const menuItem = cn(
  menuItemClass,
  'disabled:cursor-default disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-text-2',
)

/**
 * The id on the record's heading. Local, and a constant rather than a `useId`
 * because only one record renders at a time so it cannot collide.
 *
 * It was exported, with a docstring saying the wrapping sheet points an
 * `aria-labelledby` at it. `DetailSheet` does not and never did: it names
 * itself with an `sr-only` `DialogPrimitive.Title` built from the record's
 * name, which is why it takes a `name` prop. Nothing outside this file has ever
 * imported this — the export was a contract with no counterparty.
 */
const DETAIL_TITLE_ID = 'application-detail-title'

/**
 * Who the record is, and everything you can do to it as a whole.
 *
 * The overflow menu and the stage menu are one component because they hand off
 * to each other — "Move to…" closes the first and opens the second — and that
 * hand-off is a focus problem the two of them have to solve between themselves.
 */
export function DetailHeader({
  application: a,
  onPickStage,
  onEdit,
  onDraft,
  onDuplicate,
  onRequestDelete,
  onClose,
}: {
  application: Application
  onPickStage: (stage: Stage) => void
  /** Opens the application dialog in edit mode. Absent, the item disables itself. */
  onEdit?: (applicationId: string) => void
  onDraft: () => void
  onDuplicate: () => void
  onRequestDelete: () => void
  onClose: () => void
}) {
  const { update } = useApplications()
  const isDesktop = useMediaQuery(DESKTOP_QUERY)

  const [menuOpen, setMenuOpen] = useState(false)
  const [stageOpen, setStageOpen] = useState(false)

  /** Set while the overflow menu is handing off to the stage menu — see below. */
  const handingOff = useRef(false)

  const labelKey = refKey('app', a.id)

  // One <h1> per route. Above `lg` the list beside this owns it — the record is
  // a sheet over that page, not the page — so the record's name is an h2 there
  // and the page's h1 below `lg`, where the list header steps aside entirely.
  const Heading = isDesktop ? 'h2' : 'h1'

  return (
    <Panel className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {/* Only where there is no sheet to close. On a wide screen the X in
              the corner and escape are the way out, and a back link there
              would point at the list already on screen behind this. */}
          <Link
            to={applicationsPath()}
            className="inline-flex items-center gap-1 text-xs text-text-3 transition-colors hover:text-text-1 lg:hidden"
          >
            <ArrowLeft className="size-3.5" strokeWidth={2} aria-hidden />
            Applications
          </Link>
          <Heading
            id={DETAIL_TITLE_ID}
            className="mt-1.5 text-xl font-semibold break-words lg:mt-0"
          >
            {displayName(a)}
          </Heading>
          {/* The app's one relative vocabulary. "yesterday" was a sixth word
              for a gap the rest of the app spells "1 day ago". */}
          <p className="mt-0.5 text-xs text-text-3">
            {a.lastAction} · {a.daysAgo === 0 ? 'Today' : `${plural(a.daysAgo, 'day')} ago`}
          </p>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            {/* Neutral. The role is a category, not a status, and colour law
                spends colour on the user's own keywords — which sit on the
                row below this one and have to stay the loud thing.
                The hand-authored `a.chips` are gone with it: they made this
                header say "Offer" beside a stage pill already saying Offer. */}
            <Chip>{a.roleTag}</Chip>
            <StageMenu
              value={a.stage}
              onSelect={onPickStage}
              open={stageOpen}
              onOpenChange={(open) => {
                setStageOpen(open)
                if (!open) handingOff.current = false
              }}
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <LabelChips recordId={labelKey} />
            <LabelPicker recordId={labelKey} />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-pressed={Boolean(a.flagged)}
            title={a.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'}
            aria-label={a.flagged ? 'Clear the follow-up flag' : 'Flag for follow-up'}
            onClick={() =>
              update(a.id, {
                flagged: !a.flagged,
                lastAction: a.flagged ? 'Flag cleared' : 'Flagged for follow-up',
              })
            }
            className={cn(
              'grid size-8 place-items-center rounded-lg border transition-colors',
              // Amber, not red: red is this app's word for past due, so a flag
              // the user set themselves read as a missed date, and the button
              // fought the amber sidebar badge counting it.
              a.flagged
                ? 'border-warning-border bg-warning-soft text-warning'
                : 'border-hairline bg-well text-text-3 hover:border-hairline-strong hover:text-text-1',
            )}
          >
            <Flag className="size-3.5" strokeWidth={1.9} aria-hidden />
          </button>

          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger
              aria-label="More actions"
              title="More actions"
              className="grid size-8 place-items-center rounded-lg border border-hairline bg-well text-text-3 transition-colors hover:border-hairline-strong hover:text-text-1 data-[state=open]:border-accent-border data-[state=open]:bg-accent-soft data-[state=open]:text-accent"
            >
              <MoreHorizontal className="size-4" strokeWidth={1.9} aria-hidden />
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="w-52 gap-1 p-1.5"
              // Radix returns focus to this trigger as the popover closes,
              // which would pull it straight back off the stage menu we just
              // opened. Suppressed only for that one hand-off.
              onCloseAutoFocus={(event) => {
                if (handingOff.current) event.preventDefault()
              }}
            >
              <button
                type="button"
                className={menuItem}
                disabled={!onEdit}
                // The old blocker said the edit dialog was not mounted yet.
                // It is — App.tsx wires both handlers at the one place this
                // page is rendered, so this branch is unreachable today. It
                // stays as the prop contract, and now names something that
                // would actually be true if a second caller ever omitted it.
                title={
                  onEdit
                    ? undefined
                    : 'Editing is unavailable here — open this record from Applications'
                }
                onClick={() => {
                  onEdit?.(a.id)
                  setMenuOpen(false)
                }}
              >
                <Pencil className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                Edit
              </button>

              {/* The record's own way into a message. Until this existed the
                  only route to a filled thank-you was: add a reminder, go to
                  the Vault, find its row, press the Draft button on it. */}
              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  onDraft()
                }}
              >
                <PenLine className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                Draft a message
              </button>

              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  setMenuOpen(false)
                  onDuplicate()
                }}
              >
                <Copy className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                Duplicate
              </button>

              <button
                type="button"
                className={menuItem}
                onClick={() => {
                  handingOff.current = true
                  setMenuOpen(false)
                  setStageOpen(true)
                }}
              >
                <ArrowRightLeft className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                Move to…
              </button>

              <button
                type="button"
                className={cn(menuItem, 'text-danger hover:bg-danger-soft hover:text-danger')}
                onClick={() => {
                  setMenuOpen(false)
                  onRequestDelete()
                }}
              >
                <Trash2 className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                Delete
              </button>
            </PopoverContent>
          </Popover>

          {/* Last in the cluster, where a dismiss belongs. Escape does the
              same thing; both hand off to the container, which owns whatever
              the sheet has to do on the way out. */}
          <button
            type="button"
            onClick={onClose}
            title="Close this record"
            aria-label="Close this record"
            className="grid size-8 place-items-center rounded-lg border border-transparent text-text-3 transition-colors hover:border-hairline hover:bg-well hover:text-text-1"
          >
            <X className="size-4" strokeWidth={1.9} aria-hidden />
          </button>
        </div>
      </div>
    </Panel>
  )
}
