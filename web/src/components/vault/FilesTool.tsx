import { useMemo, useState } from 'react'
import { FileText, FileType, Presentation, StickyNote } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { FileViewer } from '@/components/vault/FileViewer'
import { FILE_BUCKETS, vaultFiles, type FileBucket, type FileKind } from '@/data/vault'
import { useLabels } from '@/lib/labels-context'
import { cn } from '@/lib/utils'

const kindIcon: Record<FileKind, LucideIcon> = {
  pdf: FileType,
  doc: FileText,
  slides: Presentation,
  note: StickyNote,
}

/**
 * Read-later files, in buckets.
 *
 * Open is disabled rather than hidden: the buckets and the metadata are the
 * useful part today, and a button that opened nothing would be worse than one
 * that says why it cannot yet.
 */
export function FilesTool() {
  const [bucket, setBucket] = useState<FileBucket | 'all'>('all')
  const { matches } = useLabels()
  const [openId, setOpenId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const f of vaultFiles) map[f.bucket] = (map[f.bucket] ?? 0) + 1
    return map
  }, [])

  const visible = vaultFiles.filter(
    (f) => (bucket === 'all' || f.bucket === bucket) && matches(f.id),
  )

  const open = visible.find((f) => f.id === openId) ?? null

  return (
    // The list narrows when a preview is up, so the document gets the room and
    // you can still see what else is in the bucket.
    <div className="flex flex-wrap items-start gap-4 sm:gap-5">
      <Panel className={cn('min-w-0', open ? 'flex-1 basis-[320px]' : 'w-full')}>
        <div className="mb-3.5">
          <BucketFilter
            label="Filter files by bucket"
            options={FILE_BUCKETS}
            counts={counts}
            value={bucket}
            onChange={setBucket}
            total={vaultFiles.length}
          />
        </div>

        {visible.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="Nothing in this bucket"
            description="Drop a posting, a paper or a draft here to read when you have a clear hour."
          />
        ) : (
          <ul className="divide-y divide-hairline">
            {visible.map((f) => {
              const Icon = kindIcon[f.kind]
              return (
                <li key={f.id} className="flex items-start gap-3 py-3">
                  <Icon
                    aria-hidden
                    strokeWidth={1.7}
                    className="mt-0.5 size-3.5 shrink-0 text-text-3"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-sm text-text-1">{f.name}</div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-3">
                      <span>{f.bucket}</span>
                      <span aria-hidden>·</span>
                      <span className="tabular">{f.size}</span>
                      <span aria-hidden>·</span>
                      <span>{f.savedAgo}</span>
                    </div>
                    {f.note ? (
                      <div className="mt-0.5 truncate text-xs text-text-3">{f.note}</div>
                    ) : null}
                    <LabelChips recordId={f.id} className="mt-1.5" />
                  </div>
                  <LabelPicker recordId={f.id} className="mt-0.5" />
                  <Button
                    variant={openId === f.id ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => setOpenId((prev) => (prev === f.id ? null : f.id))}
                    className="shrink-0"
                  >
                    {openId === f.id ? 'Viewing' : 'Preview'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>

      {open ? <FileViewer file={open} onClose={() => setOpenId(null)} /> : null}
    </div>
  )
}
