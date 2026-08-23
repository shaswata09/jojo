import { Link } from 'react-router'
import type { Ref } from 'react'
import { CopyPlus, Pencil, Trash2 } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { CopyFeedback } from '@/components/common/CopyFeedback'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { appPath } from '@/lib/links'
import { Button } from '@/components/ui/button'
import { MenuItem, MenuSection, RowMenu } from '@/components/common/RowMenu'
import { SNIPPET_TAGS } from '@/data/vault'
import type { Snippet, SnippetTag } from '@/data/vault'
import { cn } from '@/lib/utils'

export function SnippetCard({
  snippet: s,
  related,
  cardRef,
  focused,
  active,
  copied,
  failed,
  onOpen,
  onCopy,
  onDuplicate,
  onMove,
  onDelete,
}: {
  snippet: Snippet
  /** The application it is filed under — the record, so `appPath` has the slug. */
  related?: Application
  /** Set on the focused card only, so the tool can scroll it into view. */
  cardRef?: Ref<HTMLLIElement>
  /** Arrived here from a link that named this card — see `focus` in links.ts. */
  focused?: boolean
  /** The record the editor beside the list is working on. */
  active?: boolean
  copied: boolean
  failed: boolean
  onOpen: () => void
  onCopy: () => void
  onDuplicate: (snippet: Snippet) => void
  onMove: (snippet: Snippet, next: SnippetTag) => void
  onDelete: (id: string) => void
}) {
  return (
    <li
      ref={cardRef}
      className={cn(
        'well flex min-w-0 flex-col rounded-lg p-3',
        // The row the editor is working on, so it is obvious which
        // record the panel beside the list belongs to.
        active && 'ring-1 ring-accent-border',
        // The `-well` variant, not the plain one: this card has its
        // own fill for the tint to fade back to.
        focused && 'arrival-highlight-well',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {/* A button, not a div. It sat next to a pencil that did
              the same thing, and looked exactly like the reminder
              titles one tab over, which have always been clickable. */}
          <button
            type="button"
            onClick={onOpen}
            title="Edit this snippet"
            /* `hover:underline` as well as the colour. In the dark theme
               --accent and --text-1 are the same #fafafa (see index.css), so
               the colour change alone painted nothing and the only thing left
               saying this was a control was the cursor. */
            className="block max-w-full cursor-pointer truncate text-left text-sm text-text-1 underline-offset-2 transition-colors hover:text-accent hover:underline"
          >
            {s.title}
          </button>
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            <Chip shape="capsule" tone="gray">
              {s.tag}
            </Chip>
            {/* The job it is filed under, where the file and link rows put the
                same fact. Without it the tag was only visible by opening the
                editor, which is the state the application's own page could not
                explain. */}
            {related ? (
              <Link
                to={appPath(related)}
                className="truncate text-xs text-text-3 underline-offset-2 transition-colors hover:text-accent hover:underline"
              >
                {displayName(related)}
              </Link>
            ) : null}
            <LabelChips recordId={s.id} />
          </span>
        </div>

        <LabelPicker recordId={s.id} />
        {/* Copy stays out in the open on every card: it is what a
            snippet is for, and burying the primary action of a
            record behind ⋯ to make room for Edit would be the wrong
            way round. */}
        <Button variant="ghost" size="sm" onClick={onCopy} className="shrink-0">
          <CopyFeedback copied={copied} failed={failed} />
        </Button>
        <RowMenu name={s.title}>
          <MenuItem icon={Pencil} onSelect={onOpen}>
            Edit
          </MenuItem>
          <MenuItem icon={CopyPlus} onSelect={() => onDuplicate(s)}>
            Duplicate
          </MenuItem>
          <MenuSection title="Move to">
            {SNIPPET_TAGS.map((t) => (
              <MenuItem key={t} current={t === s.tag} onSelect={() => onMove(s, t)}>
                {t}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection>
            {/* Snippets had no delete at all before this — the only
                way to remove one was to open the editor. */}
            <MenuItem icon={Trash2} danger onSelect={() => onDelete(s.id)}>
              Delete
            </MenuItem>
          </MenuSection>
        </RowMenu>
      </div>

      {/* whitespace-pre-line so the email templates keep their breaks. */}
      <p className="mt-2.5 line-clamp-4 text-xs whitespace-pre-line text-text-2">{s.body}</p>
    </li>
  )
}
