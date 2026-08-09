import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, FormEvent, KeyboardEvent } from 'react'
import {
  FileText,
  FileType,
  Pencil,
  Plus,
  Presentation,
  StickyNote,
  Trash2,
  Upload,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Field } from '@/components/common/Field'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { FileViewer } from '@/components/vault/FileViewer'
import { MenuItem, MenuSection, RowMenu } from '@/components/vault/RowMenu'
import { VaultSearch, VaultToolbar, matchesQuery } from '@/components/vault/VaultToolbar'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, FileKind, VaultFile } from '@/data/vault'
import { kindOfFile, sizeLabel } from '@/lib/files'
import { slugify } from '@/lib/ids'
import { useLabels } from '@/lib/labels-context'
import { useVault } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'

const kindIcon: Record<FileKind, LucideIcon> = {
  pdf: FileType,
  doc: FileText,
  slides: Presentation,
  note: StickyNote,
}

/**
 * True only while something from the file system is being dragged over.
 *
 * Checked on every handler: a card dragged off the applications board also
 * fires dragover here, and a drop zone that lit up for it would be advertising
 * something it cannot accept.
 */
function draggingFiles(event: DragEvent) {
  return event.dataTransfer.types.includes('Files')
}

/**
 * One field, edited where it is read.
 *
 * Renaming a file and correcting its note are the same interaction with a
 * different label, and neither is worth a dialog — the value being changed is
 * already on screen, and a modal would cover the row it came from.
 */
function InlineEdit({
  label,
  value,
  mono,
  required,
  onSave,
  onCancel,
}: {
  label: string
  value: string
  mono?: boolean
  /** Set where an empty value would leave the record unusable — a file's name. */
  required?: boolean
  onSave: (next: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState(value)
  const blocked = Boolean(required) && !draft.trim()

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (blocked) return
    onSave(draft.trim())
  }

  // Escape backs out of an inline editor everywhere else in this app; a row that
  // could only be left with the mouse would be the odd one out.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    event.preventDefault()
    onCancel()
  }

  return (
    <form onSubmit={submit} onKeyDown={onKeyDown} className="flex flex-wrap items-end gap-2">
      <Field
        label={label}
        value={draft}
        mono={mono}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        className="min-w-[12rem] flex-1"
        onChange={(event) => setDraft(event.target.value)}
      />
      <Button
        type="submit"
        size="sm"
        disabled={blocked}
        title={blocked ? 'A file needs a name' : undefined}
      >
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

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
  const [dragging, setDragging] = useState(false)

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
  /** dragenter/dragleave fire per element, so a bare boolean flickers on every
   *  child the pointer crosses. Counting them is what makes the state hold. */
  const dragDepth = useRef(0)

  useEffect(() => {
    // A file dropped anywhere else in the window makes the browser navigate to
    // it, which throws away a session that only exists in memory. Swallowed for
    // as long as this tool is mounted; the panel below handles its own drop
    // first, on the way up.
    const swallow = (event: globalThis.DragEvent) => event.preventDefault()
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

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
    const picked = Array.from(list ?? [])
    if (picked.length === 0) return

    /**
     * `addFile` mints the id from the name and reads the store as of the last
     * render, so two files landing in one gesture cannot see each other: both
     * would take the same id, and from then on they are one row with one
     * keyword set that one delete takes out together. Deduped on the id the
     * name would produce rather than on the name itself, because that is the
     * thing that has to be unique — 'CV 2026.pdf' and 'CV-2026.pdf' slugify to
     * the same key.
     */
    const seen = new Set(files.map((f) => slugify(f.name)))
    const fresh = picked.filter((file) => {
      const key = slugify(file.name)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

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

    const skipped = picked.length - fresh.length
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
  }

  const onDragOver = (event: DragEvent) => {
    if (!draggingFiles(event)) return
    // Without this the browser refuses the drop and opens the file instead.
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }

  const onDragEnter = (event: DragEvent) => {
    if (!draggingFiles(event)) return
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragLeave = () => {
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDrop = (event: DragEvent) => {
    if (!draggingFiles(event)) return
    event.preventDefault()
    dragDepth.current = 0
    setDragging(false)
    addFiles(event.dataTransfer.files)
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

  /**
   * Every empty list names the control that emptied it. "Nothing in this bucket"
   * over a vault holding ten files, because a keyword chip is set on the page
   * header, reads as data loss rather than as a filter.
   */
  const empty = (() => {
    if (files.length === 0) {
      return {
        title: 'No files yet',
        description: 'Drop a posting, a paper or a draft here — or add one from your computer.',
        action: addButton,
      }
    }
    if (query.trim()) {
      return {
        title: 'Nothing matches that search',
        description: `No file mentions "${query.trim()}" in its name, note or bucket.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setQuery('')}>
            Clear search
          </Button>
        ),
      }
    }
    const byBucket = bucket !== 'all'
    const byKeyword = selectedLabels.size > 0

    if (byBucket && byKeyword) {
      return {
        title: 'Nothing matches both filters',
        description: `No file in ${bucket} carries the selected keywords.`,
        action: (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setBucket('all')
              clearSelected()
            }}
          >
            Clear both filters
          </Button>
        ),
      }
    }
    if (byBucket) {
      return {
        title: `Nothing in ${bucket}`,
        description: `${files.length} files are filed under the other buckets.`,
        action: (
          <Button variant="outline" size="sm" onClick={() => setBucket('all')}>
            Show all buckets
          </Button>
        ),
      }
    }
    return {
      title: 'No files carry those keywords',
      description: 'The keyword filter at the top of the page is what is hiding them.',
      action: (
        <Button variant="outline" size="sm" onClick={clearSelected}>
          Clear keywords
        </Button>
      ),
    }
  })()

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
            {visible.map((f) => {
              const Icon = kindIcon[f.kind]
              const isEditing = editing?.id === f.id

              return (
                <li
                  key={f.id}
                  ref={f.id === focus ? focusedRow : undefined}
                  className={cn(
                    'flex items-center gap-3 py-2.5',
                    f.id === focus && 'arrival-highlight -mx-2 rounded-md px-2',
                  )}
                >
                  <Icon
                    aria-hidden
                    strokeWidth={1.7}
                    className="size-3.5 shrink-0 self-start text-text-3"
                  />

                  <div className="min-w-0 flex-1">
                    {isEditing && editing.field === 'name' ? (
                      <InlineEdit
                        label="File name"
                        value={f.name}
                        mono
                        required
                        onCancel={() => setEditing(null)}
                        onSave={(next) => {
                          const before = f.name
                          updateFile(f.id, { name: next })
                          setEditing(null)
                          toast({
                            title: `${next} renamed`,
                            description: `Was ${before}.`,
                            action: {
                              label: 'Undo',
                              onClick: () => updateFile(f.id, { name: before }),
                            },
                          })
                        }}
                      />
                    ) : isEditing ? (
                      <InlineEdit
                        label="Note"
                        value={f.note ?? ''}
                        onCancel={() => setEditing(null)}
                        onSave={(next) => {
                          const before = f.note
                          updateFile(f.id, { note: next || undefined })
                          setEditing(null)
                          toast({
                            title: `${f.name} ${next ? 'note saved' : 'note cleared'}`,
                            description: next || 'The row keeps its name, bucket and keywords.',
                            action: {
                              label: 'Undo',
                              onClick: () => updateFile(f.id, { note: before }),
                            },
                          })
                        }}
                      />
                    ) : (
                      <>
                        {/* A button, not a div. It looked exactly like the
                            reminder title beside it in the same vault and did
                            nothing when clicked. */}
                        <button
                          type="button"
                          onClick={() => setEditing({ id: f.id, field: 'name' })}
                          title="Rename this file"
                          className="block max-w-full cursor-pointer truncate text-left font-mono text-sm text-text-1 transition-colors hover:text-accent"
                        >
                          {f.name}
                        </button>
                        <div className="mt-0.5 flex items-center gap-x-2 overflow-hidden text-xs text-text-3">
                          <span className="shrink-0">{f.bucket}</span>
                          <span aria-hidden>·</span>
                          <span className="tabular shrink-0">{f.size}</span>
                          {blobs[f.id] ? (
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
                      variant={openId === f.id ? 'default' : 'ghost'}
                      size="sm"
                      aria-pressed={openId === f.id}
                      onClick={() => setOpenId((prev) => (prev === f.id ? null : f.id))}
                    >
                      {openId === f.id ? 'Viewing' : 'Preview'}
                    </Button>
                    <RowMenu name={f.name}>
                      <MenuItem
                        icon={Pencil}
                        onSelect={() => setEditing({ id: f.id, field: 'name' })}
                      >
                        Rename
                      </MenuItem>
                      <MenuItem
                        icon={StickyNote}
                        onSelect={() => setEditing({ id: f.id, field: 'note' })}
                      >
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
            })}
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
