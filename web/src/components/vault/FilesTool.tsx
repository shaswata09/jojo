import { useMemo, useRef, useState } from 'react'
import { FileText, Plus, Upload } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { emptyStateFor } from '@/components/vault/empty-state'
import { matchesQuery } from '@/components/vault/search'
import { FileViewer } from '@/components/vault/FileViewer'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { FileRow } from '@/components/vault/files/FileRow'
import { sortDrop } from '@/components/vault/files/intake'
import { useFileDrop } from '@/components/vault/files/use-file-drop'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, VaultFile } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { kindOfFile, sizeLabel } from '@/lib/files'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'

/**
 * Read-later files, in buckets.
 *
 * Adding is real but stays on this machine: only the name, size and type of a
 * dropped file are read, and the `File` itself is kept in memory for as long as
 * the tab lives. Nothing is uploaded and no contents are parsed.
 *
 * Preview opens the document beside the list rather than in a new tab. A file
 * dropped this session previews for real — `URL.createObjectURL` hands the
 * actual bytes to the browser's own PDF reader — while the rows that shipped
 * with the app have no bytes behind them and get a labelled placeholder.
 */
export function FilesTool({ focus }: { focus?: string }) {
  const [bucket, setBucket] = useState<FileBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: 'name' | 'note' } | null>(null)

  /**
   * The real `File` behind a row added this session, by record id.
   *
   * Kept out of the store on purpose: a `File` is a live handle, not data, and
   * the store is the thing `exportJSON` serialises. Entries are never dropped —
   * a delete can be undone, and a record that came back with a dead preview
   * would not be an undo.
   */
  const [blobs, setBlobs] = useState<Record<string, File>>({})

  const {
    matches,
    selected: selectedLabels,
    clearSelected,
    labelIdsOf,
    setRecord,
    removeRecord,
  } = useLabels()
  const { files, addFile, updateFile, removeFile } = useVault()
  const { toast } = useToast()
  // Arrived from a graph node or a query row that named one file — see `focus`
  // in links.ts. Ten files listed with none of them marked is not an arrival.
  const focusedRow = useArrivalScroll<HTMLLIElement>(focus)

  const pickerRef = useRef<HTMLInputElement>(null)

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const f of files) map[f.bucket] = (map[f.bucket] ?? 0) + 1
    return map
  }, [files])

  const visible = files.filter(
    (f) =>
      (bucket === 'all' || f.bucket === bucket) &&
      matches(f.id) &&
      matchesQuery(query, f.name, f.note, f.bucket),
  )
  const open = visible.find((f) => f.id === openId) ?? null

  // Where a drop lands: the bucket being looked at, so adding while filtered
  // cannot file something into a list that is not on screen.
  const target: FileBucket = bucket === 'all' ? 'To read' : bucket

  const addFiles = (list: FileList | null) => {
    const { total, picked, fresh, folders, skipped } = sortDrop(list, files)
    if (total === 0) return

    if (picked.length === 0) {
      toast({
        title: folders === 1 ? 'That looks like a folder' : 'Those look like folders',
        description:
          'jojo files documents one at a time. Open the folder and drop the files in it.',
      })
      return
    }

    const added: string[] = []
    for (const file of fresh) {
      const record = addFile({
        name: file.name,
        kind: kindOfFile(file.name, file.type),
        bucket: target,
        size: sizeLabel(file.size),
      })
      added.push(record.id)
      setBlobs((prev) => ({ ...prev, [record.id]: file }))
    }

    if (fresh.length === 0) {
      toast({
        title: skipped === 1 ? 'That file is already here' : 'Those files are already here',
        description: 'A file of the same name is already in the vault.',
      })
      return
    }

    // A file added while a keyword filter is up carries no keywords yet, so it
    // is filed correctly and rendered nowhere. Saying "added" over an unchanged
    // list is how a prototype gets accused of dropping writes.
    const hidden = selectedLabels.size > 0
    const named = fresh.length === 1 ? fresh[0].name : `${fresh.length} files`
    toast({
      title: `${named} added`,
      description: hidden
        ? `Filed under ${target} — hidden while the keyword filter is on.`
        : `Filed under ${target}. Name and size only — nothing was uploaded.`,
      action: {
        label: 'Undo',
        onClick: () => added.forEach((id) => removeFile(id)),
      },
    })
    if (skipped > 0) {
      toast({
        title: `${skipped} skipped`,
        description: 'A file of the same name was already in the vault.',
      })
    }
    // Said even when the rest of the drop landed. A mixed drop that silently
    // dropped the folders would leave the user counting rows and not finding
    // the number they expected.
    if (folders > 0) {
      toast({
        title: folders === 1 ? '1 folder skipped' : `${folders} folders skipped`,
        description:
          'jojo files documents one at a time. Open the folder and drop the files in it.',
      })
    }
  }

  const { dragging, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop(addFiles)

  const onRename = (file: VaultFile, next: string) => {
    const before = file.name
    updateFile(file.id, { name: next })
    setEditing(null)
    toast({
      title: `${next} renamed`,
      description: `Was ${before}.`,
      action: {
        label: 'Undo',
        onClick: () => updateFile(file.id, { name: before }),
      },
    })
  }

  const onNote = (file: VaultFile, next: string) => {
    const before = file.note
    updateFile(file.id, { note: next || undefined })
    setEditing(null)
    toast({
      title: `${file.name} ${next ? 'note saved' : 'note cleared'}`,
      description: next || 'The row keeps its name, bucket and keywords.',
      action: {
        label: 'Undo',
        onClick: () => updateFile(file.id, { note: before }),
      },
    })
  }

  const onMove = (file: VaultFile, next: FileBucket) => {
    const before = file.bucket
    updateFile(file.id, { bucket: next })
    toast({
      title: `${file.name} moved`,
      description: `Filed under ${next}${bucket !== 'all' && bucket !== next ? ` — out of the ${bucket} list you are looking at` : ''}.`,
      action: { label: 'Undo', onClick: () => updateFile(file.id, { bucket: before }) },
    })
  }

  /**
   * A file record is a name, a size and a note — and every one of those comes
   * back with Undo, so it goes on a toast rather than a confirmation dialog.
   * The dialog that used to stand here asked about the one thing that was never
   * at risk: the document itself, which was never uploaded and is untouched.
   */
  const onDelete = (file: VaultFile) => {
    const stashed = labelIdsOf(file.id)
    const { restore } = removeFile(file.id)
    removeRecord(file.id)
    if (openId === file.id) setOpenId(null)
    if (editing?.id === file.id) setEditing(null)

    toast({
      title: `${file.name} deleted`,
      description: 'The row, its note and its keywords go. The file on your computer is untouched.',
      tone: 'danger',
      action: {
        label: 'Undo',
        onClick: () => {
          restore()
          // Guarded: `setRecord` with an empty list files the record as carrying
          // no keywords rather than leaving it unmentioned.
          if (stashed.length > 0) setRecord(file.id, stashed)
        },
      },
    })
  }

  const addButton = (
    <Button size="sm" onClick={() => pickerRef.current?.click()}>
      <Plus className="size-3.5" strokeWidth={2} aria-hidden />
      Add file
    </Button>
  )

  const empty = emptyStateFor({
    total: files.length,
    query,
    filteredByBucket: bucket !== 'all',
    filteredByKeyword: selectedLabels.size > 0,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setBucket('all'),
    onClearKeywords: clearSelected,
    copy: {
      zero: {
        title: 'No files yet',
        description: 'Drop a posting, a paper or a draft here — or add one from your computer.',
        action: addButton,
      },
      search: (q) => `No file mentions "${q}" in its name, note or bucket.`,
      both: `No file in ${bucket} carries the selected keywords.`,
      bucket: {
        title: `Nothing in ${bucket}`,
        description: `${files.length} files are filed under the other buckets.`,
        clearLabel: 'Show all buckets',
      },
      keywords: { title: 'No files carry those keywords' },
    },
  })

  return (
    // The list narrows when a preview is up, so the document gets the room and
    // you can still see what else is in the bucket.
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel
        className={cn('relative min-w-0', open ? 'flex-1 basis-[320px]' : 'w-full')}
        onDragEnter={onDragEnter}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        {/* Hidden rather than sr-only: the Button in the toolbar is the labelled
            control, and a second focus stop reading "Choose files" would be a
            control nobody can see. */}
        <input
          ref={pickerRef}
          type="file"
          multiple
          hidden
          // Cleared after every pick, or choosing the same file twice fires no
          // change event the second time and the button looks broken.
          onChange={(event) => {
            addFiles(event.target.files)
            event.target.value = ''
          }}
        />

        {files.length > 0 ? (
          <VaultToolbar
            filter={
              <BucketFilter
                label="Filter files by bucket"
                options={FILE_BUCKETS}
                counts={counts}
                value={bucket}
                onChange={setBucket}
                total={files.length}
              />
            }
            search={
              <VaultSearch
                label="Search files"
                placeholder="Search name or note"
                value={query}
                onChange={setQuery}
              />
            }
            action={addButton}
          />
        ) : null}

        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title={empty.title}
            description={empty.description}
            action={empty.action}
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {visible.map((f) => (
              <FileRow
                key={f.id}
                file={f}
                focused={f.id === focus}
                rowRef={f.id === focus ? focusedRow : undefined}
                editingField={editing?.id === f.id ? editing.field : undefined}
                onDevice={Boolean(blobs[f.id])}
                previewing={openId === f.id}
                onEdit={(field) => setEditing({ id: f.id, field })}
                onCancelEdit={() => setEditing(null)}
                onRename={onRename}
                onNote={onNote}
                onTogglePreview={() => setOpenId((prev) => (prev === f.id ? null : f.id))}
                onMove={onMove}
                onDelete={onDelete}
              />
            ))}
          </ul>
        )}

        {/* `pointer-events-none` so the drag events keep reaching the panel
            underneath — an overlay that swallowed them would cancel the drop it
            is advertising. */}
        {dragging ? (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 grid place-items-center rounded-lg border-2 border-dashed border-accent-border bg-panel/90 text-center"
          >
            <div>
              <Upload aria-hidden strokeWidth={1.7} className="mx-auto mb-2 size-5 text-accent" />
              <p className="text-sm font-medium text-text-1">Drop to add to {target}</p>
              <p className="mt-1 text-xs text-text-3">
                Name, size and type are read. Nothing is uploaded.
              </p>
            </div>
          </div>
        ) : null}

        {/* The drop target is invisible until something is over it, so the one
            line that says it exists has to be here in the quiet state. */}
        <p className="mt-3 text-xs text-text-3">
          Drop files anywhere on this panel to add them to {target}.
        </p>
      </Panel>

      {open ? (
        <FileViewer
          file={open}
          // Present only for a file added this session — that is what turns the
          // placeholder into the actual document.
          blob={blobs[open.id]}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  )
}
