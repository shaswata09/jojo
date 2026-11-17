import { Copy, Flag, Pencil, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { MenuItem, RowMenu as OverflowMenu } from '@/components/common/RowMenu'
import type { RowActions } from '@/components/applications/use-row-actions'
import { displayName, type Application } from '@/data/seed'
import { cn } from '@/lib/utils'

/**
 * Edit · Duplicate · Delete on an applications row.
 *
 * A wrapper over the shared `RowMenu`, not a second menu. This file used to be
 * one: same trigger classes to the byte, same three items in the same order,
 * and three differences nobody chose — a `w-44` popover against the vault's
 * `w-48`, an item class missing `cursor-pointer`, and no `danger` styling
 * beyond a hand-written `cn()`. The one that reached users was the cursor: the
 * app's longest list was the only place a ⋯ item did not look clickable.
 *
 * Kept as a named wrapper rather than inlined at the call site because the
 * three actions and their order are the contract `RowMenu`'s header states, and
 * a call site is free to reorder what it spells out.
 */
export function RowMenu({ app, actions }: { app: Application; actions: RowActions }) {
  const { t } = useTranslation('applications')
  return (
    <OverflowMenu name={displayName(app)}>
      <MenuItem icon={Pencil} onSelect={() => actions.onEdit(app)}>
        {t('common.edit')}
      </MenuItem>
      <MenuItem icon={Copy} onSelect={() => actions.onDuplicate(app)}>
        {t('common.duplicate')}
      </MenuItem>
      <MenuItem icon={Trash2} danger onSelect={() => actions.requestDelete(app)}>
        {t('common.delete')}
      </MenuItem>
    </OverflowMenu>
  )
}

export function FlagButton({
  app,
  onFlag,
}: {
  app: Application
  onFlag: (a: Application) => void
}) {
  const { t } = useTranslation('applications')
  const label = app.flagged ? t('common.clearFlag') : t('common.flag')
  return (
    <button
      type="button"
      aria-pressed={Boolean(app.flagged)}
      aria-label={
        app.flagged
          ? t('common.clearFlagOn', { name: displayName(app) })
          : t('common.flagOn', { name: displayName(app) })
      }
      title={label}
      onClick={() => onFlag(app)}
      className={cn(
        'grid size-7 shrink-0 cursor-pointer place-items-center rounded-md border transition-colors',
        // Amber, not red: red is this app's word for past due, so a flag the
        // user set themselves read as a missed date, and the button fought the
        // amber sidebar badge counting it.
        app.flagged
          ? 'border-warning-border bg-warning-soft text-warning'
          : 'border-transparent text-text-3 hover:border-hairline hover:bg-well hover:text-text-1',
      )}
    >
      <Flag className="size-3.5" strokeWidth={1.9} aria-hidden />
    </button>
  )
}
