import type { Ref } from 'react'
import { Link } from 'react-router'
import { Copy, ExternalLink, Link2, Pencil, Trash2 } from 'lucide-react'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { MenuItem, MenuSection, RowMenu } from '@/components/vault/RowMenu'
import { hostOf } from '@/components/vault/links/url'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { LINK_CATEGORIES } from '@/data/vault'
import type { LinkCategory, VaultLink } from '@/data/vault'
import { appPath } from '@/lib/links'
import { cn } from '@/lib/utils'

export function LinkRow({
  link: l,
  related,
  focused,
  rowRef,
  onEdit,
  onDuplicate,
  onMove,
  onDelete,
}: {
  link: VaultLink
  /** The application it is filed under — the record, so `appPath` has the slug. */
  related?: Application
  /** Arrived here from a link that named this row — see `focus` in links.ts. */
  focused?: boolean
  /** Set on the focused row only, so the tool can scroll it into view. */
  rowRef?: Ref<HTMLLIElement>
  onEdit: () => void
  onDuplicate: (link: VaultLink) => void
  onMove: (link: VaultLink, next: LinkCategory) => void
  onDelete: (link: VaultLink) => void
}) {
  return (
    <li
      ref={rowRef}
      className={cn(
        'flex items-center gap-2 py-2.5',
        focused && 'arrival-highlight -mx-2 rounded-md px-2',
      )}
    >
      <Link2
        aria-hidden
        strokeWidth={1.7}
        className="mt-0.5 size-3.5 shrink-0 self-start text-text-3"
      />

      <div className="min-w-0 flex-1">
        {/* The title opens the editor, matching the reminder and file
            rows, where a title that looks like this is the way in to
            correcting the record. The address below leaves the app —
            it is the one line that is unambiguously about elsewhere,
            and it is also the thing you would check before following. */}
        <button
          type="button"
          onClick={onEdit}
          className="block max-w-full cursor-pointer truncate text-left text-sm text-text-1 transition-colors hover:text-accent"
        >
          {l.title}
        </button>

        <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs text-text-3">
          <a
            href={l.url}
            target="_blank"
            // noreferrer as well as noopener: the target should not
            // learn where the click came from.
            rel="noopener noreferrer"
            className="group flex min-w-0 items-center gap-1 font-mono underline-offset-2 transition-colors hover:text-accent hover:underline"
          >
            <span className="truncate">{hostOf(l.url)}</span>
            <ExternalLink
              aria-label="Opens in a new tab"
              role="img"
              strokeWidth={1.7}
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            />
          </a>
          {l.note ? <span className="truncate">· {l.note}</span> : null}
          {related ? (
            <Link
              to={appPath(related)}
              className="shrink-0 truncate underline-offset-2 transition-colors hover:text-accent hover:underline"
            >
              · {displayName(related)}
            </Link>
          ) : null}
          <LabelChips recordId={l.id} className="shrink-0" />
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <LabelPicker recordId={l.id} />
        <RowMenu name={l.title}>
          <MenuItem icon={Pencil} onSelect={onEdit}>
            Edit
          </MenuItem>
          <MenuItem icon={Copy} onSelect={() => onDuplicate(l)}>
            Duplicate
          </MenuItem>
          <MenuSection title="Move to">
            {LINK_CATEGORIES.map((c) => (
              <MenuItem key={c} current={c === l.category} onSelect={() => onMove(l, c)}>
                {c}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection>
            <MenuItem icon={Trash2} danger onSelect={() => onDelete(l)}>
              Delete
            </MenuItem>
          </MenuSection>
        </RowMenu>
      </div>
    </li>
  )
}
