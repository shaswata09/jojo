import { useEffect, useMemo, useRef, useState } from 'react'
import { useApplications } from '@jojo/service/react/use-applications'
import { displayName, filedUnderLabel } from '@/data/seed'
import { FileText, Plus, Upload } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { emptyStateFor } from '@/components/vault/empty-state'
import { matchesQuery } from '@/components/vault/search'
import { CaptureInbox } from '@/components/vault/CaptureInbox'
import { FileViewer } from '@/components/vault/FileViewer'
import { VaultSearch, VaultToolbar } from '@/components/vault/VaultToolbar'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { FileRow } from '@/components/vault/files/FileRow'
import type { EditableField } from '@/components/vault/files/FileRow'
import { sortDrop } from '@/components/vault/files/intake'
import { useFileDelete } from '@/lib/use-file-delete'
import { useFileDrop } from '@/components/vault/files/use-file-drop'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, VaultFile } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { kindOfFile, sizeLabel } from '@/lib/files'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'
import { report } from '@/lib/analytics'

/**
 * Read-later files, in buckets.
 *
 * Adding is real and stays on this machine: the dropped file's bytes are stored
 * in IndexedDB (`lib/vault-blobs`) and survive closing the tab. Nothing is
 * uploaded and no contents are parsed.
 *
 * This paragraph used to say the opposite — "only the name, size and type of a
 * dropped file are read, and the `File` itself is kept in memory for as long as
 * the tab lives" — which was true and was the bug: the record naming a document
 * outlived the document. A comment describing a design that has been replaced is
 * worse than none, because it is the thing a reader trusts.
 *
 * Preview opens the document beside the list rather than in a new tab, from the
 * stored bytes, on any visit rather than only the one that filed it. A row still
 * gets a labelled placeholder when it genuinely has no document — a demo record,
 * a page captured on another device, or a write that failed.
 */
export function FilesTool({ focus }: { focus?: string }) {
  const [bucket, setBucket] = useState<FileBucket | 'all'>('all')
  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string; field: EditableField } | null>(null)

  /**
   * The real `File` behind a row added this session, by record id.
   *
   * Kept out of the store on purpose: a `File` is a live handle, not data, and
   * the store is the thing `exportJSON` serialises. Entries are never dropped —
   * a delete can be undone, and a record that came back with a dead preview
   * would not be an undo.
   */
  /**
   * Bytes, in IndexedDB rather than in React state.
   *
   * This was `useState<Record<string, File>>({})`: the dropped file was read and
   * previewed, and then discarded when the tab closed, leaving the record that
   * named it behind. For a vault whose whole job is the documents tailored to
   * each application, that is the one thing it must not do.
   */
  const blobs = useVaultBlobs()
  /**
   * The open document's bytes.
   *
   * Loaded when the viewer opens rather than held for every row: the list can
   * hold hundreds of records and reading them all to render a list would pull
   * every document into memory to show a filename.
   */
  const [openBlob, setOpenBlob] = useState<File | null>(null)

  // The keyword half of a delete moved into `useFileDelete` with the rest of it.
  const { matches, selected: selectedLabels, clearSelected } = useLabels()
  const { files, addFile, updateFile, removeFile } = useVault()
  // Named for the row's link, the toast and the search; the picker reads the
  // list itself.
  const { byId } = useApplications()

  const nameOf = (id?: string) => {
    const app = id ? byId.get(id) : undefined
    return app ? displayName(app) : undefined
  }
  const { toast } = useToast()
  const deleteFile = useFileDelete()
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
      // The application's name too, matching the links tool: a document you can
      // file under a job is one you will look for by that job's name.
      matchesQuery(query, f.name, f.note, f.bucket, ...f.applicationIds.map(nameOf)),
  )
  const open = visible.find((f) => f.id === openId) ?? null

  // Where a drop lands: the bucket being looked at, so adding while filtered
  // cannot file something into a list that is not on screen.
  const target: FileBucket = bucket === 'all' ? 'To read' : bucket

  useEffect(() => {
    if (openId === null) {
      setOpenBlob(null)
      return
    }
    let alive = true
    void blobs.get(openId).then((file) => {
      // Guarded: the viewer can be closed, or another row opened, while a large
      // document is still being read, and the late answer would otherwise
      // replace what is now on screen.
      if (alive) setOpenBlob(file)
    })
    return () => {
      alive = false
    }
  }, [openId, blobs])

  const addFiles = (list: FileList | null) => {
    // `blobs.has` so a record left without its document — a write refused on
    // quota — is refillable rather than rejected as a duplicate of itself.
    const { total, picked, fresh, refill, folders, skipped } = sortDrop(list, files, (f) =>
      blobs.has(f.id),
    )
    if (total === 0) return

    if (picked.length === 0) {
      toast({
        title: folders === 1 ? 'That looks like a folder' : 'Those look like folders',
        description:
          'jojo files documents one at a time. Open the folder and drop the files in it.',
      })
      return
    }

    // Refills first: they add no rows, so the toast below can still speak about
    // what was newly filed without counting them twice.
    for (const { file, record } of refill) {
      void blobs.put(record.id, file).then((stored) => {
        toast(
          stored
            ? {
                title: `${file.name} is attached again`,
                description: 'The row was already here without its document. It has one now.',
              }
            : {
                title: `${file.name} still could not be saved`,
                description:
                  'This browser refused to store it again — its storage is probably still full.',
                tone: 'danger',
              },
        )
      })
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
      // Per file, inside the loop: dropping six documents at once is six
      // filings, and counting the gesture instead of the documents would make a
      // bulk drop look like a single use of the feature.
      report('vault_item_added', { kind: 'file' })
      // Not awaited, so the row appears immediately — a 5 MB write measured 15 ms
      // but a slow disk or a full quota can take much longer, and blocking the
      // drop on it would make filing feel broken.
      //
      // The RESULT is not discarded, though. It used to be, and the toast said
      // "added" either way: a write that failed on quota left a row on screen
      // naming a document that was never stored, which is the failure this whole
      // feature exists to end. A refusal now says so.
      void blobs.put(record.id, file).then((stored) => {
        if (stored) return
        toast({
          title: `${file.name} was filed, but not saved`,
          description:
            'The row is here, but this browser refused to store the document — usually because its storage is full. Free some space and drop the same file in again; it will attach to this row rather than making a second one.',
          tone: 'danger',
        })
      })
    }

    if (fresh.length === 0 && refill.length === 0) {
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
        : `Filed under ${target} and saved in this browser. Nothing was uploaded anywhere.`,
      action: {
        label: 'Undo',
        onClick: () =>
          added.forEach((id) => {
            removeFile(id)
            // The second place a record can go away, and it needs the same
            // treatment as `onDelete`: undoing an add that has already stored
            // its bytes would otherwise leave them in IndexedDB with no record
            // pointing at them and no way to reach them again.
            void blobs.remove(id)
          }),
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

  /**
   * Files the document under a job, or under none.
   *
   * The key is always PRESENT in the patch, including when the value is
   * undefined — that is what says "set this field" as opposed to "leave it
   * alone", and `asNull` in `kg/react/patch.ts` turns a present-and-undefined
   * into the `null` the tool reads as an unfile. Spreading it conditionally
   * would silently make clearing the field impossible.
   *
   * The edge is `fromCardinality: 'many'`, so this SETS the whole list rather
   * than adding to it: what the picker shows is what the record ends up with.
   */
  const onFileUnder = (file: VaultFile, applicationIds: string[]) => {
    const before = file.applicationIds
    updateFile(file.id, { applicationIds })
    setEditing(null)
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      // `filedUnderLabel` names up to two and counts past that. It lives in the
      // service because every surface that files a record — here, the phone's
      // three vault tools, its file viewer — has the same sentence to build,
      // and five copies is five places to draw that line differently.
      title: `${file.name} ${filedUnderLabel(chosen)}`,
      description:
        chosen.length > 0
          ? 'It shows on each of them, and the graph can find it from any.'
          : 'It stays in the Vault, filed under nothing.',
      action: {
        label: 'Undo',
        onClick: () => updateFile(file.id, { applicationIds: before }),
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
  /**
   * The same delete the Profile page uses.
   *
   * Was written out here; it moved to `lib/use-file-delete` when a second screen
   * needed it, because a document is four things — the record, its keywords, the
   * bytes and whatever is on screen showing it — and a second copy would have
   * got the record and forgotten the bytes.
   */
  const onDelete = (file: VaultFile) => {
    deleteFile(file, (id) => {
      if (openId === id) setOpenId(null)
      if (editing?.id === id) setEditing(null)
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

        {/* Above the toolbar rather than in it: this is about documents that
            are not in the list yet, so a control that filters the list is the
            wrong neighbourhood. It renders nothing when nothing is waiting. */}
        <CaptureInbox />

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
                related={f.applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)}
                editingField={editing?.id === f.id ? editing.field : undefined}
                onDevice={blobs.has(f.id)}
                previewing={openId === f.id}
                onEdit={(field) => setEditing({ id: f.id, field })}
                onCancelEdit={() => setEditing(null)}
                onRename={onRename}
                onNote={onNote}
                onTogglePreview={() => setOpenId((prev) => (prev === f.id ? null : f.id))}
                onFileUnder={onFileUnder}
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
          // The stored bytes, once they have been read back. Absent for a seed
          // row, which falls back to the generated placeholder.
          blob={openBlob ?? undefined}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  )
}
