import { useState } from 'react'
import { Download, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import type { Rows } from '@jojo/service/storage/driver'
import { useBoot } from '@/lib/boot-context'
import { revokeLater } from '@/lib/save-file'

/**
 * The store is there and it cannot be read.
 *
 * This is the one screen in jojo where doing nothing is the correct default. A
 * corrupt database NEVER auto-reseeds (R-1): reseeding to make the app look
 * healthy turns a recoverable problem into a permanent one, and it does it while
 * looking like a successful boot. So there is no app behind this panel — the
 * corrupt arm of `BootState` carries no session at all, which means there is
 * nothing mounted that could write over what is still on disk.
 *
 * The three ways forward are ordered by what they cost, which is not the order
 * they are usually written in. *Download what we could read* comes first because
 * it is the only one that is not destructive and the only one that stops being
 * available afterwards. *Try again* is second because a transient failure — a
 * locked database, a browser that was mid-eviction — is the likeliest cause.
 * *Start fresh* is last, is the only one behind a confirmation, and says in the
 * dialog that it deletes rather than repairs.
 */

/**
 * The rescue file: every row that came back, exactly as it was on disk.
 *
 * Deliberately NOT the app's export format. `exportJSON` writes projections —
 * applications, timeline, vault — and projecting requires a validated graph,
 * which is the thing that just failed. Rows straight out of the object stores
 * are the most that can honestly be offered, and they are enough for someone to
 * recover a record by hand or for a later importer to read.
 */
const rescueFile = (rows: Rows) =>
  JSON.stringify(
    {
      jojoRescue: 1,
      note: 'Raw rows read from a jojo database that could not be opened normally. Not an import file.',
      counts: {
        nodes: rows.nodes.length,
        edges: rows.edges.length,
        meta: rows.meta.length,
        ops: rows.ops.length,
      },
      ...rows,
    },
    null,
    2,
  )

export function StoreRecovery({ detail, rescued }: { detail: string; rescued: Rows | null }) {
  const { t } = useTranslation()
  const { retry, startFresh, busy } = useBoot()
  const [confirming, setConfirming] = useState(false)

  /**
   * A Blob URL pins its data in memory until it is revoked, so the handle is
   * released as soon as the click has been dispatched — otherwise a rescue of a
   * large store would leak a copy of it for the life of the tab, on the one
   * screen where the tab is likely to sit open for a while.
   */
  const onDownload = () => {
    if (!rescued) return
    const blob = new Blob([rescueFile(rescued)], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'jojo-rescued-rows.json'
    anchor.click()
    // Not now, and not on the next task either. A synchronous revoke races the
    // download the click just started and hands back an EMPTY file, and Firefox
    // resolves blob URLs late enough that the next task can lose it too — and
    // this is the rescue export from a store that will not open, so it is the
    // one download where an empty file means losing their records.
    revokeLater(href)
  }

  const rescuedCount = rescued ? rescued.nodes.length + rescued.edges.length : 0

  return (
    <div className="grid min-h-dvh place-items-center p-3 sm:p-5">
      <div className="surface w-full max-w-lg rounded-lg px-5 py-5">
        <div className="flex items-start gap-2.5">
          <TriangleAlert
            className="mt-0.5 size-4 shrink-0 text-danger"
            strokeWidth={1.8}
            aria-hidden
          />
          <div className="min-w-0">
            <h1 className="text-lg font-medium">{t('recovery.title')}</h1>
            {/* Says what has NOT happened, because that is the question. The
                records are still on disk; nothing here has deleted or replaced
                anything, and nothing will until a button below is pressed. */}
            <p className="mt-2 text-sm text-text-2">{t('recovery.body')}</p>
          </div>
        </div>

        <pre className="mt-4 max-h-32 overflow-auto rounded-sm bg-well p-3 font-mono text-xs text-text-3">
          {detail}
        </pre>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onDownload}
            disabled={!rescued}
            title={rescued ? t('recovery.downloadHint') : t('recovery.downloadNothing')}
          >
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            {t('recovery.download')}
          </Button>
          <Button variant="outline" size="sm" onClick={retry} disabled={busy}>
            <RotateCcw className="size-3.5" strokeWidth={1.8} aria-hidden />
            {busy ? t('recovery.working') : t('recovery.retry')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirming(true)}
            disabled={busy}
            title={t('recovery.freshHint')}
          >
            <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
            {t('recovery.fresh')}
          </Button>
        </div>

        <p className="mt-3 text-xs text-text-3">
          {rescued ? t('recovery.readable', { count: rescuedCount }) : t('recovery.unreadable')}
        </p>

        <ConfirmDialog
          open={confirming}
          onOpenChange={setConfirming}
          title={t('recovery.confirmTitle')}
          description={t('recovery.confirmBody')}
          confirmLabel={t('recovery.confirm')}
          tone="danger"
          onConfirm={startFresh}
        />
      </div>
    </div>
  )
}
