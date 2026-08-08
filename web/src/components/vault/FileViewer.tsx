import { useEffect, useMemo, useState } from 'react'
import { FileQuestion, X } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import type { VaultFile } from '@/data/vault'
import { pdfObjectUrl, placeholderPdf } from '@/lib/placeholder-pdf'

/**
 * Shows a file in the browser's own document viewer.
 *
 * An `<iframe>` pointed at a PDF hands rendering to whatever reader the browser
 * ships — scrolling, zoom, page count, find, print, all of it — which is the
 * behaviour asked for and none of which is worth reimplementing.
 *
 * Only PDFs get a preview. A browser cannot render .doc or .slides, and dressing
 * one up in a viewer frame would promise something it cannot do.
 */
export function FileViewer({ file, onClose }: { file: VaultFile; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)

  const pdf = useMemo(
    () =>
      file.kind === 'pdf'
        ? placeholderPdf({
            title: file.name,
            lines: [
              { text: 'Placeholder preview', size: 12 },
              { text: `${file.size} · ${file.bucket} · saved ${file.savedAgo}`, gap: 6 },
              ...(file.note ? [{ text: file.note }] : []),
              {
                text: 'The real document appears here once files are stored locally.',
                gap: 14,
              },
            ],
          })
        : null,
    [file],
  )

  useEffect(() => {
    if (!pdf) return setUrl(null)
    const next = pdfObjectUrl(pdf)
    setUrl(next)
    // Blob URLs pin their data in memory until revoked, so every preview would
    // leak a document for the life of the tab without this.
    return () => URL.revokeObjectURL(next)
  }, [pdf])

  return (
    <Panel className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="mb-3 flex items-start justify-between gap-3">
        <PanelTitle className="mb-0 truncate font-mono text-sm">{file.name}</PanelTitle>
        <Button variant="ghost" size="sm" onClick={onClose} className="shrink-0">
          <X className="size-3.5" strokeWidth={2} aria-hidden />
          Close
        </Button>
      </div>

      {url ? (
        <iframe
          key={url}
          src={url}
          title={`${file.name} preview`}
          className="min-h-[28rem] w-full flex-1 rounded-md border border-hairline bg-well"
        />
      ) : (
        <EmptyState
          icon={FileQuestion}
          title="No preview for this type"
          description={`Browsers render PDFs natively but not ${file.kind} files. Opening it will hand off to your own application once files are stored locally.`}
        />
      )}
    </Panel>
  )
}
