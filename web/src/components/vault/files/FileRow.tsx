import type { Ref } from 'react'
import { Link } from 'react-router'
import {
  Briefcase,
  FileText,
  FileType,
  Pencil,
  Presentation,
  StickyNote,
  Trash2,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { Button } from '@/components/ui/button'
import { MenuItem, MenuSection, RowMenu } from '@/components/common/RowMenu'
import { ApplicationPicker } from '@/components/vault/ApplicationPicker'
import { InlineEdit } from '@/components/vault/files/InlineEdit'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, FileKind, VaultFile } from '@/data/vault'
import type { Application } from '@/data/seed'
import { displayName } from '@/data/seed'
import { appPath } from '@/lib/links'
import { cn } from '@/lib/utils'

/**
 * The three things a row can be editing in place.
 *
 * `application` joins the two text fields rather than becoming a menu of every
 * job: the bucket list above it is four fixed words and fits a dropdown, but the
 * applications are however many you are tracking, and a menu is the one control
 * that cannot be searched.
 */
export type EditableField = 'name' | 'note' | 'application'

const kindIcon: Record<FileKind, LucideIcon> = {
  pdf: FileType,
  doc: FileText,
  slides: Presentation,
  note: StickyNote,
}

export function FileRow({
  file: f,
  focused,
  rowRef,
  related,
  editingField,
  onDevice,
  previewing,
  onEdit,
  onCancelEdit,
  onRename,
  onNote,
  onTogglePreview,
  onFileUnder,
  onMove,
  onDelete,
}: {
  file: VaultFile
  /** The application it is filed under — the record, so `appPath` has the slug. */
  related?: Application
  /** Arrived here from a link that named this row — see `focus` in links.ts. */
  focused?: boolean
  /** Set on the focused row only, so the tool can scroll it into view. */
  rowRef?: Ref<HTMLLIElement>
  /** Which field is open in the inline editor, if any. */
  editingField?: EditableField
  /** The real bytes are in this session, so Preview shows the document itself. */
  onDevice: boolean
  previewing: boolean
  onEdit: (field: EditableField) => void
  onCancelEdit: () => void
  onRename: (file: VaultFile, next: string) => void
  onNote: (file: VaultFile, next: string) => void
  /** `undefined` unfiles it. The tool turns that into a `null` for the tool layer. */
  onFileUnder: (file: VaultFile, applicationId: string | undefined) => void
  onTogglePreview: () => void
  onMove: (file: VaultFile, next: FileBucket) => void
  onDelete: (file: VaultFile) => void
}) {
  const Icon = kindIcon[f.kind]

  return (
    <li
      ref={rowRef}
      className={cn(
        'flex items-center gap-3 py-2.5',
        focused && 'arrival-highlight -mx-2 rounded-md px-2',
      )}
    >
      <Icon aria-hidden strokeWidth={1.7} className="size-3.5 shrink-0 self-start text-text-3" />

      <div className="min-w-0 flex-1">
        {editingField === 'name' ? (
          <InlineEdit
            label="File name"
            value={f.name}
            mono
            required
            onCancel={onCancelEdit}
            onSave={(next) => onRename(f, next)}
          />
        ) : editingField === 'note' ? (
          <InlineEdit
            label="Note"
            value={f.note ?? ''}
            onCancel={onCancelEdit}
            onSave={(next) => onNote(f, next)}
          />
        ) : editingField === 'application' ? (
          /* No Save button, unlike the two text fields above: a combobox commits
             on the choice, and a second confirmation for a value you cannot
             mistype is ceremony. Cancel stays, because opening the wrong row's
             picker is a mis-tap worth backing out of. */
          <div className="flex items-center gap-2">
            <ApplicationPicker
              what="file"
              value={f.applicationId}
              onChange={(id) => onFileUnder(f, id)}
              className="flex-1"
            />
            <Button type="button" variant="ghost" size="sm" onClick={onCancelEdit}>
              Cancel
            </Button>
          </div>
        ) : (
          <>
            {/* A button, not a div. It looked exactly like the
                reminder title beside it in the same vault and did
                nothing when clicked. */}
            <button
              type="button"
              onClick={() => onEdit('name')}
              title="Rename this file"
              /* `hover:underline` as well as the colour. In the dark theme
                 --accent and --text-1 are the same #fafafa (see index.css), so
                 the colour change alone painted nothing and the file name gave
                 no sign it could be clicked to rename. */
              className="block max-w-full cursor-pointer truncate text-left font-mono text-sm text-text-1 underline-offset-2 transition-colors hover:text-accent hover:underline"
            >
              {f.name}
            </button>
            <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs text-text-3">
              <span className="shrink-0">{f.bucket}</span>
              <span aria-hidden>·</span>
              <span className="tabular shrink-0">{f.size}</span>
              {onDevice ? (
                <>
                  <span aria-hidden>·</span>
                  {/* Worth saying: it is the difference between a
                      real preview and a generated stand-in. */}
                  <span className="shrink-0">on this device</span>
                </>
              ) : null}
              {f.note ? <span className="truncate">· {f.note}</span> : null}
              {related ? (
                <Link
                  to={appPath(related)}
                  className="shrink-0 truncate underline-offset-2 transition-colors hover:text-accent hover:underline"
                >
                  · {displayName(related)}
                </Link>
              ) : null}
              <LabelChips recordId={f.id} className="shrink-0" />
            </div>
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <LabelPicker recordId={f.id} />
        <Button
          variant={previewing ? 'default' : 'ghost'}
          size="sm"
          aria-pressed={previewing}
          onClick={onTogglePreview}
        >
          {previewing ? 'Viewing' : 'Preview'}
        </Button>
        <RowMenu name={f.name}>
          <MenuItem icon={Pencil} onSelect={() => onEdit('name')}>
            Rename
          </MenuItem>
          <MenuItem icon={StickyNote} onSelect={() => onEdit('note')}>
            {f.note ? 'Edit note' : 'Add note'}
          </MenuItem>
          <MenuItem icon={Briefcase} onSelect={() => onEdit('application')}>
            {related ? 'Change application' : 'File under an application'}
          </MenuItem>
          <MenuSection title="Move to">
            {FILE_BUCKETS.map((b) => (
              <MenuItem key={b} current={b === f.bucket} onSelect={() => onMove(f, b)}>
                {b}
              </MenuItem>
            ))}
          </MenuSection>
          <MenuSection>
            <MenuItem icon={Trash2} danger onSelect={() => onDelete(f)}>
              Delete
            </MenuItem>
          </MenuSection>
        </RowMenu>
      </div>
    </li>
  )
}
