import type { Ref } from 'react'
import { FileText, FileType, Pencil, Presentation, StickyNote, Trash2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { LabelChips, LabelPicker } from '@/components/common/LabelPicker'
import { Button } from '@/components/ui/button'
import { MenuItem, MenuSection, RowMenu } from '@/components/vault/RowMenu'
import { InlineEdit } from '@/components/vault/files/InlineEdit'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, FileKind, VaultFile } from '@/data/vault'
import { cn } from '@/lib/utils'

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
  editingField,
  onDevice,
  previewing,
  onEdit,
  onCancelEdit,
  onRename,
  onNote,
  onTogglePreview,
  onMove,
  onDelete,
}: {
  file: VaultFile
  /** Arrived here from a link that named this row — see `focus` in links.ts. */
  focused?: boolean
  /** Set on the focused row only, so the tool can scroll it into view. */
  rowRef?: Ref<HTMLLIElement>
  /** Which field is open in the inline editor, if either. */
  editingField?: 'name' | 'note'
  /** The real bytes are in this session, so Preview shows the document itself. */
  onDevice: boolean
  previewing: boolean
  onEdit: (field: 'name' | 'note') => void
  onCancelEdit: () => void
  onRename: (file: VaultFile, next: string) => void
  onNote: (file: VaultFile, next: string) => void
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
        ) : editingField ? (
          <InlineEdit
            label="Note"
            value={f.note ?? ''}
            onCancel={onCancelEdit}
            onSave={(next) => onNote(f, next)}
          />
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
