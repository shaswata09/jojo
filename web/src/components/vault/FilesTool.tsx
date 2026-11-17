import { useEffect, useMemo, useRef, useState } from 'react'
import { useApplications } from '@jojo/service/react/use-applications'
import { displayName } from '@/data/seed'
import { FileText, Plus, Upload } from 'lucide-react'
import { useTranslation } from 'react-i18next'
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
import { useFileIntake } from '@/components/vault/files/use-file-intake'
import { UnfiledChip } from '@/components/vault/files/UnfiledChip'
import { unfiledCount, visibleFiles } from '@/components/vault/files/filters'
import { useFileDelete } from '@/lib/use-file-delete'
import { useFileDrop } from '@/components/vault/files/use-file-drop'
import { FILE_BUCKETS } from '@/data/vault'
import type { FileBucket, VaultFile } from '@/data/vault'
import { useVault } from '@jojo/service/react/use-vault'
import { useLabels } from '@/lib/labels-context'
import { useToast } from '@/lib/toast-context'
import { useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'
import { readableDocuments } from '@jojo/service/core/twin'
import { useGraph } from '@jojo/service/react/kg-context'
import { requestProfileRead } from '@jojo/service/react/profile-read-request'
import { useModelSettings } from '@/lib/model-settings-context'
import { announceRefusal } from '@/components/common/write-result'
import { useDomain } from '@/i18n/domain'
import { fileBucketLabel, fileBucketLabels } from '@/components/vault/files/bucket-label'
import { ShowMoreRows } from '@/components/common/ShowMoreRows'
import { useRowCap } from '@/components/common/use-row-cap'

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
  const { t } = useTranslation('vault')
  const domain = useDomain()
  const [bucket, setBucket] = useState<FileBucket | 'all'>('all')
  /** The "Unfiled" chip: only files not filed under any application. */
  const [unfiledOnly, setUnfiledOnly] = useState(false)
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
  const graph = useGraph()
  const { settings } = useModelSettings()
  /*
   * The rows that can be read into the profile from here: a document with
   * bytes on this device, that is not an employer's, while a model is
   * connected to read it with. `blobs` carries its revision, so a document
   * whose bytes land a moment after its record is offered on the next render.
   */
  const readable = useMemo(
    () =>
      settings.model.trim() === ''
        ? new Set<string>()
        : new Set(readableDocuments(graph, (f) => blobs.has(f.id)).map((d) => d.id)),
    [graph, blobs, settings.model],
  )
  const readIntoProfile = (file: VaultFile) => {
    requestProfileRead({ fileId: file.id, name: file.name })
    // The banner is above the route; a question nobody can see is not asked.
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
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
  const { files, updateFile } = useVault()
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

  const loose = useMemo(() => unfiledCount(files), [files])

  const visible = visibleFiles(files, {
    bucket,
    unfiledOnly,
    keywords: matches,
    // The application's name too, matching the links tool: a document you can
    // file under a job is one you will look for by that job's name.
    search: (f) =>
      matchesQuery(
        query,
        f.name,
        f.note,
        f.bucket,
        fileBucketLabel(f.bucket),
        ...f.applicationIds.map(nameOf),
      ),
  })
  const open = visible.find((f) => f.id === openId) ?? null
  // A page of rows at a time, always including the one a link arrived at.
  const cap = useRowCap(visible.length, focus ? visible.findIndex((f) => f.id === focus) : -1)

  // Where a drop lands: the bucket being looked at, so adding while filtered
  // cannot file something into a list that is not on screen.
  const target: FileBucket = bucket === 'all' ? 'To read' : bucket
  // The drawer as the reader names it, for sentences. Only read where a chip is on.
  const bucketShown = bucket === 'all' ? '' : fileBucketLabel(bucket)

  useEffect(() => {
    // Cleared first, every time: until the new document's read resolves, the
    // last one's bytes would otherwise sit under the new one's name.
    setOpenBlob(null)
    if (openId === null) return
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

  // The shared intake (`use-file-intake.ts`) — the Profile page files through
  // it too. A file added while a keyword filter is up carries no keywords yet,
  // so it is filed correctly and rendered nowhere; the toast says so.
  const addFiles = useFileIntake({
    bucket: target,
    hidden: selectedLabels.size > 0,
    reportAdds: true,
  })

  const { dragging, onDragEnter, onDragOver, onDragLeave, onDrop } = useFileDrop(addFiles)

  const onRename = (file: VaultFile, next: string) => {
    const before = file.name
    if (announceRefusal(updateFile(file.id, { name: next }), toast)) return
    setEditing(null)
    toast({
      title: t('files.toast.renamed', { name: next }),
      description: t('files.toast.was', { name: before }),
      action: {
        label: t('common.undo'),
        onClick: () => updateFile(file.id, { name: before }),
      },
    })
  }

  const onNote = (file: VaultFile, next: string) => {
    const before = file.note
    if (announceRefusal(updateFile(file.id, { note: next || undefined }), toast)) return
    setEditing(null)
    toast({
      title: next
        ? t('files.toast.noteSaved', { name: file.name })
        : t('files.toast.noteCleared', { name: file.name }),
      description: next || t('files.toast.noteClearedDescription'),
      action: {
        label: t('common.undo'),
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
    if (announceRefusal(updateFile(file.id, { applicationIds }), toast)) return
    setEditing(null)
    const chosen = applicationIds.map((id) => byId.get(id)).filter((a) => a !== undefined)
    toast({
      // `domain.filedUnder` names up to two and counts past that. It lives in
      // the service because every surface that files a record — here, the
      // phone's three vault tools, its file viewer — has the same sentence to
      // build, and five copies is five places to draw that line differently.
      title: t('files.toast.filed', {
        name: file.name,
        filed: domain.filedUnder(chosen.map(displayName)),
      }),
      description:
        chosen.length > 0 ? t('files.toast.filedDescription') : t('files.toast.unfiledDescription'),
      action: {
        label: t('common.undo'),
        onClick: () => updateFile(file.id, { applicationIds: before }),
      },
    })
  }

  const onMove = (file: VaultFile, next: FileBucket) => {
    const before = file.bucket
    if (announceRefusal(updateFile(file.id, { bucket: next }), toast)) return
    toast({
      title: t('reminders.toast.moved', { title: file.name }),
      description:
        bucket !== 'all' && bucket !== next
          ? t('snippets.toast.movedOut', {
              tag: fileBucketLabel(next),
              filter: fileBucketLabel(bucket),
            })
          : t('snippets.toast.moved', { tag: next }),
      action: { label: t('common.undo'), onClick: () => updateFile(file.id, { bucket: before }) },
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
      {t('files.add')}
    </Button>
  )

  const empty = emptyStateFor({
    total: files.length,
    query,
    filteredByBucket: bucket !== 'all',
    filteredByKeyword: selectedLabels.size > 0,
    filteredByUnfiled: unfiledOnly,
    onClearQuery: () => setQuery(''),
    onClearBucket: () => setBucket('all'),
    onClearKeywords: clearSelected,
    onClearUnfiled: () => setUnfiledOnly(false),
    copy: {
      zero: {
        title: t('files.empty.zeroTitle'),
        description: t('files.empty.zeroDescription'),
        action: addButton,
      },
      search: (q) => t('files.empty.search', { query: q }),
      both: t('files.empty.both', { bucket: bucketShown }),
      bucket: {
        title: t('files.empty.bucketTitle', { bucket: bucketShown }),
        description: t('files.empty.bucketDescription', { count: files.length }),
        clearLabel: t('files.empty.showAll'),
      },
      keywords: { title: t('files.empty.keywordsTitle') },
      unfiled: {
        // Not a failure. Every file being filed is the state this list is for
        // getting to, and "no files" over a full vault would read as a bug.
        alone: {
          title: t('files.empty.allFiledTitle'),
          description: t('files.empty.allFiledDescription', { count: files.length }),
        },
        withOthers:
          bucket === 'all'
            ? t('files.empty.unfiledKeywords')
            : t('files.empty.unfiledBucket', { bucket: bucketShown }),
      },
    },
  })

  return (
    // The list narrows when a preview is up, so the document gets the room and
    // you can still see what else is in the bucket.
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel
        data-tour="files"
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
              /* One wrapping row, so the toggle joins the chips rather than
                 taking a line of its own — and wraps with them when narrow. */
              <div className="flex flex-wrap items-center gap-1.5">
                <BucketFilter
                  label={t('files.filterLabel')}
                  options={FILE_BUCKETS}
                  labels={fileBucketLabels()}
                  counts={counts}
                  value={bucket}
                  onChange={setBucket}
                  total={files.length}
                />
                <UnfiledChip on={unfiledOnly} count={loose} onChange={setUnfiledOnly} />
              </div>
            }
            search={
              <VaultSearch
                label={t('files.searchLabel')}
                placeholder={t('files.searchPlaceholder')}
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
            {visible.slice(0, cap.shown).map((f) => (
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
                onReadIntoProfile={readable.has(f.id) ? readIntoProfile : undefined}
              />
            ))}
          </ul>
        )}
        <ShowMoreRows shown={cap.shown} hidden={cap.hidden} onMore={cap.more} />

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
              <p className="text-sm font-medium text-text-1">
                {t('files.drop.title', { bucket: fileBucketLabel(target) })}
              </p>
              <p className="mt-1 text-xs text-text-3">{t('files.drop.description')}</p>
            </div>
          </div>
        ) : null}

        {/* The drop target is invisible until something is over it, so the one
            line that says it exists has to be here in the quiet state. */}
        <p className="mt-3 text-xs text-text-3">
          {t('files.drop.hint', { bucket: fileBucketLabel(target) })}
        </p>
      </Panel>

      {open ? (
        <FileViewer
          file={open}
          // The stored bytes, once they have been read back. Absent for a seed
          // row, which falls back to the generated placeholder.
          blob={openBlob ?? undefined}
          // Keyed by document: the viewer holds a note draft, and two files
          // with the same stored note (both empty) would otherwise carry one
          // file's unsaved note onto the next, where Save writes it.
          key={open.id}
          onClose={() => setOpenId(null)}
        />
      ) : null}
    </div>
  )
}
