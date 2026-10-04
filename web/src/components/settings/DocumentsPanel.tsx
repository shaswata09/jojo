import { useEffect, useState } from 'react'
import { Download, HardDrive, TriangleAlert } from 'lucide-react'
import { dayOf } from '@jojo/service/core/project'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { readStorageUsage } from '@/components/settings/storage-usage'
import { archiveName, buildArchive, uniqueEntryNames } from '@/lib/document-archive'
import { reportError } from '@/lib/report-error'
import { saveFile } from '@/lib/save-file'
import { useToast } from '@/lib/toast-context'
import { useVaultBlobs } from '@/lib/vault-blobs'

/**
 * Where the documents actually are, and how to get them out.
 *
 * Replaces a panel that offered a folder picker and three switches, none of
 * which did anything: the picker bound a directory nothing ever wrote a document
 * to, and `autoSync`, `snapshots` and `watchFolder` were `useState` with no
 * reader. The heading promised "Save to a file on this computer" and the copy
 * promised "keeps a copy in files you own, outside the browser" — neither was
 * true, which is the same defect that panel's original text field had.
 *
 * ## Why this exists at all rather than just being deleted
 *
 * The documents live in IndexedDB and IndexedDB is evictable. `persist()` is
 * requested on the first write and granted on engagement heuristics — measured
 * `false` on a fresh profile, which is exactly a new user. "Clear browsing data"
 * always wins regardless. So a person can lose every tailored CV they filed, and
 * the only honest mitigation is a way to get the bytes out, said plainly, in the
 * place they would look. A warning with no button is just bad news.
 */
export function DocumentsPanel() {
  const blobs = useVaultBlobs()
  const { toast } = useToast()
  const [count, setCount] = useState(0)
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const [safe, setSafe] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    void blobs.all().then((list) => {
      if (alive) setCount(list.length)
    })
    /*
     * Through `readStorageUsage`, not `navigator.storage.estimate()` raw: that
     * promise rejects in an opaque origin, and this call is `void`ed, so the
     * rejection reached `main.tsx` and logged a crash for a browser that had
     * only declined to answer. Same missing line on screen either way.
     */
    void readStorageUsage().then((figures) => {
      if (alive && figures !== null) setUsage(figures)
    })
    void blobs.persisted().then((p) => {
      if (alive) setSafe(p)
    })
    return () => {
      alive = false
    }
  }, [blobs])

  /**
   * Every document, as one ZIP — see `lib/document-archive.ts` for why one
   * archive replaced a download per file.
   *
   * Everything that can throw is inside the `try`: a quota read, a document
   * whose bytes will not come back, `zipSync` itself, `createObjectURL` on an
   * exhausted blob store. The caller `void`s this, so a throw outside it would
   * have been no file and no toast — a button that does nothing, on the one
   * path a person uses to keep their CVs.
   */
  const downloadAll = async () => {
    setBusy(true)
    try {
      const list = await blobs.all()
      const files = (await Promise.all(list.map((item) => blobs.get(item.id)))).filter(
        (file): file is File => file !== null,
      )
      if (files.length === 0) {
        toast({
          title: 'No documents could be read',
          description: 'This browser no longer holds the bytes for any of them.',
          tone: 'danger',
        })
        return
      }
      const names = uniqueEntryNames(files.map((file) => file.name))
      const entries = await Promise.all(
        files.map(async (file, i) => ({
          name: names[i] ?? file.name,
          bytes: new Uint8Array(await file.arrayBuffer()),
          modified: file.lastModified,
        })),
      )
      const name = archiveName(dayOf(new Date().toISOString()))
      saveFile(buildArchive(entries), name, 'application/zip')

      const missing = list.length - files.length
      const noun = (n: number) => `${n} document${n === 1 ? '' : 's'}`
      toast({
        title: missing === 0 ? `${noun(files.length)} saved` : `${files.length} of ${list.length} saved`,
        description:
          missing === 0
            ? `One file, ${name}, in your downloads folder. These are the originals, not copies of the records.`
            : `${name} is in your downloads folder, without ${noun(missing)} this browser could no longer read.`,
        ...(missing === 0 ? {} : { tone: 'danger' as const }),
      })
    } catch (error) {
      reportError('backup', error)
      toast({
        title: 'Could not build the download',
        description: 'Nothing was saved. Try again, or open a document and download it on its own.',
        tone: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`

  return (
    <Panel>
      <PanelTitle hint="on this device">Your documents</PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        The CVs, cover letters and statements you attach are saved in this browser, on this
        machine. Nothing is uploaded anywhere.
      </p>

      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5 rounded-lg border border-hairline bg-well px-3 py-2.5 text-sm">
          <HardDrive className="size-4 shrink-0 text-text-3" strokeWidth={1.8} aria-hidden />
          <span className="text-text-1">
            {count === 0
              ? 'No documents yet'
              : `${count} document${count === 1 ? '' : 's'} stored`}
          </span>
          {usage ? (
            <span className="ml-auto text-xs text-text-3">
              {mb(usage.used)} of {mb(usage.quota)} used
            </span>
          ) : null}
        </div>

        {/* The warning and the way out sit together on purpose. */}
        {safe === false ? (
          <div className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-3 py-2.5 text-xs text-warning">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
            <p>
              This browser has not marked jojo&rsquo;s storage as permanent, so it may clear these
              documents if the disk fills up — and &ldquo;Clear browsing data&rdquo; will remove
              them whatever it says. Keep your own copies of anything you would not want to
              rewrite.
            </p>
          </div>
        ) : null}

        <Button
          variant="outline"
          size="sm"
          disabled={busy || count === 0}
          onClick={() => void downloadAll()}
        >
          <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
          {busy ? 'Saving…' : 'Download every document'}
        </Button>
      </div>
    </Panel>
  )
}
