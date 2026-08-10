import type { MenuAction } from '@/components/ui/Menu'

/**
 * The overflow menu every saved record carries, in one order.
 *
 * **Edit · Duplicate · [Move to …] · Delete** — destructive last and red. The
 * order is part of the contract, not a per-screen decision: before the web app
 * settled it, Reminders had a 24px circular ⋯, Files a 28px rounded-square one,
 * and Links and Snippets had no menu at all — a naked pencil and a naked bin
 * sitting where the other tabs put one button.
 *
 * A naked bin is the specific thing this rules out. **A delete has to cost a
 * menu**, because the one-tap version is a mis-tap away from destroying work and
 * an undo toast is a weaker guard than never firing the write.
 *
 * `move` lists the buckets flat rather than behind a submenu: a sheet inside a
 * sheet is a dismissal chain nothing here needs, and there are never more than
 * four options.
 */
export function buildRecordMenu<T extends string>({
  onEdit,
  editLabel = 'Edit',
  onDuplicate,
  extra,
  move,
  onDelete,
  deleteLabel = 'Delete',
}: {
  onEdit?: () => void
  /** Where "Edit" is too vague — Files splits it into Rename and Edit note. */
  editLabel?: string
  onDuplicate?: () => void
  /** Anything specific to one kind of record, between Duplicate and Move to. */
  extra?: MenuAction[]
  /** The one-of-N the record sits in: a link's category, a file's bucket. */
  move?: {
    /** Names the axis in the row's own words — "Move to bucket". */
    label: string
    options: readonly T[]
    current: T
    onMove: (next: T) => void
  }
  onDelete: () => void
  deleteLabel?: string
}): MenuAction[] {
  return [
    ...(onEdit ? [{ id: 'edit', label: editLabel, icon: 'edit-2' as const, onPress: onEdit }] : []),
    ...(onDuplicate
      ? [{ id: 'duplicate', label: 'Duplicate', icon: 'copy' as const, onPress: onDuplicate }]
      : []),
    ...(extra ?? []),
    ...(move
      ? move.options.map((option) => ({
          id: `move-${option}`,
          label: `${move.label}: ${option}`,
          icon: 'folder' as const,
          // The option already in force is listed so the set reads whole, and
          // ticked so it is obvious which one that is — but pressing it would
          // be a write with no change behind it, so it does nothing.
          checked: option === move.current,
          disabled: option === move.current,
          onPress: () => move.onMove(option),
        }))
      : []),
    { id: 'delete', label: deleteLabel, icon: 'trash-2', tone: 'danger', onPress: onDelete },
  ]
}
