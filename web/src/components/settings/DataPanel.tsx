import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { Download, Share2, Sparkles, Trash2, Upload } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { SettingRow } from '@/components/common/Field'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { pendingCopy } from '@/components/settings/data-confirm-copy'
import { restoreSummary } from '@/components/settings/restore-report'
import type { RestoreReport } from '@/components/settings/restore-report'
import { BACKUP_ACCEPT, exportFilename } from '@/components/settings/export-name'
import type { PendingData } from '@/components/settings/data-confirm-copy'
import { Button } from '@/components/ui/button'
import { report } from '@/lib/analytics'
import { bucket } from '@jojo/service/core/analytics'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useStoreAdmin } from '@jojo/service/react/use-admin'
import { useBoot } from '@/lib/boot-context'
import { transferPath } from '@/lib/links'
import { clearSiteData } from '@/lib/storage'
import { useBackup } from '@/lib/backup'
import { restoreBackup } from '@jojo/service/repo/restore'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { readBackup, describeBackup } from '@jojo/service/core/backup'
import type { RestorePlan } from '@jojo/service/core/backup'
import { useKg } from '@jojo/service/react/kg-context'
import { useToast } from '@/lib/toast-context'

export function DataPanel() {
  const { exportJSON, clearAll, isEmpty, dataSet } = useStoreAdmin()
  // The readable half is still `exportJSON`'s projections; the restorable half is
  // the raw rows and the document bytes that `useBackup` adds around them.
  const backup = useBackup(exportJSON)
  const blobs = useVaultBlobs()
  const { repo } = useKg()
  /** A validated backup waiting for the user to confirm replacing everything. */
  const [staged, setStaged] = useState<RestorePlan | null>(null)
  /**
   * What the restore did, held on screen until the reader has acknowledged it.
   *
   * The reload below is why this is state rather than a toast. `onRestore` used
   * to raise a toast and call `window.location.reload()` on the next line; the
   * reload fires about 200ms later and takes the toast with it, so the one
   * sentence that mattered — "188 could not be read and were left out" — was
   * composed correctly and never rendered once. A restore that quietly drops
   * records is the exact failure `core/backup.ts` says the reader exists to
   * prevent, and it was being reported into a message nobody could see.
   */
  const [outcome, setOutcome] = useState<RestoreReport | null>(null)
  const importRef = useRef<HTMLInputElement>(null)

  /**
   * Reads a chosen file and stages it. Nothing is replaced until the dialog is
   * confirmed — a restore is not undoable, because `replaceAll` clears the
   * journal along with everything else.
   */
  const onPickBackup = async (list: FileList | null) => {
    const file = list?.[0]
    if (!file) return
    const read = readBackup(await file.text())
    if (!read.ok) {
      toast({
        title: 'That file cannot be restored',
        description: `${read.error.message}. Nothing has been changed.`,
        tone: 'danger',
      })
      return
    }
    setStaged(read.value)
  }

  const onRestore = async () => {
    if (staged === null) return
    const plan = staged
    setStaged(null)
    const done = await restoreBackup(repo, blobs, plan, new Date().toISOString())
    if (!done.ok) {
      toast({ title: 'The restore failed', description: done.message, tone: 'danger' })
      return
    }
    // After the outcome is known, so a failed restore is not counted as one.
    // Bucketed, like the export half — see `core/analytics.ts`.
    report('backup_used', { direction: 'restore', records: bucket(done.nodes) })
    /*
     * The reload waits for the reader.
     *
     * Every projection, cache and epoch in this page describes the store that
     * was just replaced, so the page has to go — but it goes when the outcome
     * has been read, not before it has been drawn. `held` is what the file
     * promised, so the dialog can say both numbers when they disagree instead
     * of reporting only the smaller one.
     */
    setOutcome({
      held: plan.nodes.length,
      nodes: done.nodes,
      documents: done.documents,
      skipped: done.skipped,
    })
  }
  const { state, closeStore, chooseDataSet, busy } = useBoot()
  const { toast } = useToast()
  const [pending, setPending] = useState<PendingData | null>(null)
  const [clearing, setClearing] = useState(false)

  /** Whether the records themselves are on disk. Not the same question as whether
      the browser will keep the theme — the banner above answers that one. */
  const durable = state.phase === 'ready'

  /**
   * Every promise this panel makes is a promise about the next reload, and on a
   * session with no database there is nothing to make it with.
   *
   * The closing paragraph below already branched on `durable`; the toasts and
   * the confirmation dialog did not, so a store running in memory — a private
   * window, a browser that refuses IndexedDB — got an honest red banner at the
   * top of the page and, two inches under it, a dialog promising the records
   * would "stay gone after a reload" and a toast saying they were "written to
   * your database". A page that contradicts its own banner within a screenful
   * teaches the reader to believe neither of them.
   */
  const persists = durable
    ? 'and it stays that way across a reload'
    : 'though nothing is being saved right now, so a reload starts over from the demo data'

  /**
   * Writes the store to a file the browser downloads.
   *
   * A Blob URL pins its data in memory until it is revoked, so the handle is
   * released as soon as the click has been dispatched — otherwise every export
   * would leak a copy of the whole store for the life of the tab.
   *
   * Dated in the filename because this is a backup now rather than a debugging
   * dump: a second export used to overwrite the first in the downloads folder,
   * or land as "jojo-data (1).json", which is not a name anyone can choose
   * between six months later.
   *
   * The BUTTON was not renamed with it and read "Export jojo-data.json" for as
   * long as the file was called something else — a label naming a filename that
   * has never once been written, next to a toast naming the real one. It says
   * "Export a backup" now: the date makes an exact name impossible to print on
   * a button, so the button stops trying and the toast, which knows the date,
   * is the one that names the file to look for.
   *
   *
   * WHAT THIS CAN AND CANNOT HONESTLY CLAIM
   *
   * The panel's own closing sentence is that an exported file kept somewhere
   * else is the only real backup, which makes a false claim here the worst
   * sentence in the app: a user told their backup exists stops looking for one.
   * Two things went wrong, and they are opposite failures of the same missing
   * `try`.
   *
   * `URL.createObjectURL` can throw — a blocked or exhausted blob store. There
   * was no catch, so the exception escaped the click handler to `window.onerror`
   * and the user saw NOTHING happen. A button that does nothing at all reads as
   * a bug in the button, not as a warning about their records.
   *
   * And the toast fired unconditionally. Under an enterprise `DownloadRestrictions`
   * policy the download is cancelled with zero bytes written, and jojo said the
   * file "was written to your downloads". So the copy is now scoped to what a
   * page can actually observe: dispatching the click is the last thing we know
   * happened. The browser's decision after that is not visible to us — there is
   * no event for it — so the toast says the download started and names the file
   * to look for, which is true in every case, rather than asserting an outcome
   * that is false in one.
   */
  /**
   * Writes a backup that can actually be restored.
   *
   * This used to write `exportJSON()` alone — the projections, which are
   * denormalised views with no record of the nodes and edges behind them, and
   * therefore readable but not restorable. Worse, the documents were not in it
   * at all, so the one file a person was told was "the only copy of your records
   * outside this device" did not contain their CV.
   *
   * The readable half is still in there, under `readable`, so the file opens
   * into something recognisable.
   */
  const onExport = () => {
    const name = exportFilename(new Date())
    // `.catch` as well as `.then`. `download` now catches its own failures and
    // resolves `false`, so this should never fire — which is exactly why it is
    // here: without it, one unguarded throw inside that promise went nowhere at
    // all, and the user pressed Export and watched nothing happen.
    void backup
      .download(name)
      .catch(() => false)
      .then((started) => {
        if (!started) {
          toast({
            title: 'The backup could not be written',
            description:
              'Your records are unchanged and nothing was saved. If your browser blocked the download, check its download settings.',
            tone: 'danger',
          })
          return
        }
        toast({
          title: 'Backup started',
          // Named, not asserted. The click is the last thing this page can
          // observe — the browser's decision after it fires no event — so what is
          // said is what to look for rather than that it arrived.
          description: `Look for ${name} in your downloads. It holds your records and every document you have attached.`,
        })
      })
  }

  /**
   * Nothing in this store is the user's yet.
   *
   * `dataSet` flips to 'user' on the first commit they make (`touched` in `kg/repo/meta.ts`), so
   * 'demo' is a store that has been loaded and not touched since — which makes it
   * the one case where clearing may take the KEYWORDS too. Ordinarily
   * `memory.clear` keeps them on purpose (D14: a keyword is the user's own system
   * and outlives any one set of records), but the twenty keywords in an untouched
   * demo store were authored by the fixtures, and leaving them behind is demo data
   * surviving a button that says everything goes.
   *
   * Taken from `useStoreAdmin()` rather than from `sessionOf(state)?.meta`. Both
   * read the same getter, but only one of them is on a subscription React will
   * re-run this component for; the other was correct by accident. See the note
   * on `dataSet` in `use-admin.ts`.
   */
  const untouchedDemo = dataSet === 'demo'

  /**
   * Empties the browser, then reloads into a jojo that has never run here.
   *
   * The database is closed FIRST, and that ordering is the whole of it.
   * `deleteDatabase` against a database this tab still has open fires `blocked`
   * and queues the delete until the connection goes away — so the wipe reported
   * "1 database" and the records were still there on the next load, which is the
   * one outcome a button called "clear storage" must never produce.
   *
   * Then a reload, rather than a toast and a tab carrying on. After this the
   * store's driver is shut and its rows are deleted, while the graph is still in
   * memory — so every list on screen is showing records that no longer exist
   * anywhere, and the first edit would go to a closed database. `clearAll()` used
   * to paper over that by emptying the graph too; it is gone because a reload
   * does the honest version, and it is also how the demo data legitimately comes
   * back: the meta row went with the database, so the next boot is a first run.
   *
   * The theme goes with it, and that is visible: the stored preference is gone,
   * so the reload picks up the system setting. The dialog says so.
   */
  const onClearStorage = async () => {
    setClearing(true)
    try {
      closeStore()
      await clearSiteData()
      window.location.reload()
    } finally {
      // In a finally: a browser that blocks one of the stores throws past the
      // await, and a button stuck reading "Clearing…" would be the only thing
      // left to tell the user what happened.
      setClearing(false)
    }
  }

  /**
   * Both data writes go through `chooseDataSet`, which is the same call the
   * first-run fork makes.
   *
   * That is the point of routing them here rather than at the `memory.reset` /
   * `memory.clear` tools they used to call. A tool walks the graph and emits a
   * delete per node, so "cleared" was only ever as complete as the type list at
   * the top of `tools/memory.ts`; `repo.replaceAll` empties every object store
   * inside one transaction. And a tool commit cannot write the meta row —
   * `land()` stamps `dataSet: 'user'` on any write — so a store the user asked to
   * empty recorded itself as full of their records.
   *
   * The exception below is deliberate. Once `dataSet` is 'user' the keywords in
   * this store may be the user's own, and taking them is loss the dialog did not
   * warn about; `memory.clear` is the write that keeps them, and it stays the one
   * used on a store that has been written to.
   */
  const onLoadDemo = async () => {
    if (!(await chooseDataSet('demo'))) return
    toast({
      title: 'Demo data loaded',
      description: durable
        ? 'Twelve applications, a timeline, a stocked vault and a profile, written to your database as they shipped.'
        : 'Twelve applications, a timeline, a stocked vault and a profile, as they shipped. Nothing is being saved right now, so they last as long as this tab does.',
    })
  }

  const onClearRecords = async () => {
    if (untouchedDemo) {
      if (!(await chooseDataSet('empty'))) return
    } else {
      clearAll()
    }
    toast({
      title: 'Everything cleared',
      description: untouchedDemo
        ? `Every demo record is gone, keywords included, ${persists}.`
        : `Every record is gone, your profile included, ${persists}. Your keywords are still here.`,
      tone: 'danger',
    })
  }

  const applyPending = () => {
    if (pending === 'storage') {
      void onClearStorage()
      return
    }
    if (pending === 'empty') {
      void onClearRecords()
      return
    }
    void onLoadDemo()
  }

  const copy = pendingCopy({ untouchedDemo, isEmpty, durable, persists, onExport })

  return (
    <>
      <Panel>
        <PanelTitle>Your data</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            Download a backup
          </Button>
          <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
            <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
            Restore a backup
          </Button>
          <input
            ref={importRef}
            type="file"
            accept={BACKUP_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void onPickBackup(e.target.files)
              // Cleared so choosing the SAME file twice fires change again — a
              // restore that silently does nothing the second time is worse than
              // one that fails.
              e.target.value = ''
            }}
          />
          <Button
            variant="outline"
            size="sm"
            disabled
            title="No spreadsheet writer is bundled — the JSON export holds the same records"
          >
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            Export to Excel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled
            title="Reading a backup back in needs a validator that can refuse a file it does not understand — until that exists, an import could only guess"
          >
            <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
            Import
          </Button>
        </div>
        {/* The old sentence here ended "keywords live in their own store and are
            not in it yet", which is why the export was described as a partial
            one. There is one store now and this is all of it, so the paragraph
            says what a backup is instead — including the part people get wrong,
            which is that the file does not update itself. */}
        <p className="mt-2 text-xs text-text-3">
          A full backup: every application, the timeline, the vault, saved postings, your keywords
          and their tags, and your profile, in one versioned file. It is a copy taken now — it does
          not keep up with later changes, and it is the only copy that is not on this machine.
        </p>

        <div className="mt-4">
          {/* A button rather than the Demo data / Empty segment that stood here.
              A segment states what the store IS and leaves the reader to work
              out that pressing the other half will rewrite their records; the
              thing a person is actually looking for on this page is "show me
              what jojo looks like with something in it", and that is a verb.
              The state the segment carried has not been dropped — it is the
              description, which is the half of a segment that was doing the
              work anyway. */}
          <SettingRow
            label="Records"
            /* Three readings, because the old two said "the seeded search" about a
               store the user had spent a month filling — `isEmpty` cannot tell a
               demo store from an authored one, and only the meta row can. */
            description={
              isEmpty
                ? `Every list is empty, so every page is showing its first-run state.${durable ? ' It stays empty when you come back.' : ''}`
                : untouchedDemo
                  ? 'The demo search jojo ships with — twelve applications, a timeline, a stocked vault. None of it is yours yet.'
                  : 'Your own records. Loading the demo data replaces them, so export a backup first if you want them.'
            }
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={busy}
                onClick={() => setPending('demo')}
              >
                <Sparkles className="size-3.5" strokeWidth={1.8} aria-hidden />
                Load demo data
              </Button>
            }
          />
          <SettingRow
            label="Clear every record"
            description={
              untouchedDemo
                ? 'Removes the demo data and leaves jojo empty. Nothing here is yours yet, so the seeded keywords go with it.'
                : 'Removes every application, timeline item, vault entry, saved posting and your profile. Your keywords are kept.'
            }
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={busy || isEmpty}
                title={isEmpty ? 'There is nothing left to clear' : 'Deletes every record'}
                onClick={() => setPending('empty')}
              >
                <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                Clear records
              </Button>
            }
          />
          {/* Export writes a file you then have to carry somewhere; this is the
              other half of the same question, so it belongs in the same panel
              rather than behind a nav item someone has to already know about.
              The description says what the page is up front — a row here that
              turned out to be a demonstration would be a worse surprise than
              one that says so before you press it. */}
          <SettingRow
            label="Move to another device"
            description="Pair with a second device and hand over everything. A demonstration in this build — nothing is transmitted."
            control={
              <Button variant="outline" size="sm" asChild>
                <Link to={transferPath()}>
                  <Share2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                  Open Transfer
                </Link>
              </Button>
            }
          />
          {/* Last in the panel, because it is the largest hammer in it: the two
              rows above change what is in the app, this one leaves nothing of
              jojo on the machine at all. */}
          <SettingRow
            label="Clear browser storage"
            description="Empties everything this site has stored in your browser — your records and their database, every document you have attached, preferences, caches and cookies — then reloads jojo as if it were new. Documents are only here; download them first if you want to keep them."
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={clearing}
                onClick={() => setPending('storage')}
              >
                <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                {clearing ? 'Clearing…' : 'Clear storage'}
              </Button>
            }
          />
        </div>

        {/*
         * What stood here was: "Nothing is written to disk in this build — the
         * store lives in memory for as long as the tab is open, so a reload puts
         * the demo data back and takes your changes with it."
         *
         * That sentence is the one this whole change exists to remove, and it is
         * deleted rather than softened. What replaces it makes the opposite
         * claim, so it has to keep being true: it says where the records are,
         * and — because a browser can still evict an origin, and this machine
         * can still fail — that a file you have copied somewhere else is the only
         * thing that is actually a backup. Diagnostics below is what turns "your
         * records are saved" from a claim into something checkable.
         */}
        <p className="mt-4 text-xs text-text-3">
          {durable
            ? "Your records are written to this browser's database as you work, so closing the tab is safe. That database is still on this one machine: a browser can clear it and a disk can fail, so an exported file kept somewhere else is the only real backup."
            : 'Your records are not being saved right now — the banner at the top of the page says why. Export a copy before you close the tab.'}
        </p>
      </Panel>

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={pending ? copy[pending].title : 'Change the data?'}
        description={pending ? copy[pending].description : ''}
        confirmLabel={pending ? copy[pending].confirm : 'Continue'}
        tone="danger"
        onConfirm={applyPending}
      />

      {/*
        What the restore did, and the only way off it is the reload.
        
        Not a `ConfirmDialog`, because that one offers Cancel and there is
        nothing left to cancel — the store was replaced before this rendered.
        Escape and the backdrop reload too: every projection in the page behind
        this describes a store that no longer exists, so there is no state here
        worth returning to.
      */}
      {outcome === null ? null : (
        <RestoreOutcomeDialog report={outcome} onDone={() => window.location.reload()} />
      )}

      {/* Separate from the dialog above because what it must say is different:
          that one asks about data the user can see, this one names what is in a
          file they cannot. `describeBackup` is that sentence. */}
      <ConfirmDialog
        open={staged !== null}
        onOpenChange={(open) => {
          if (!open) setStaged(null)
        }}
        title="Replace everything with this backup?"
        description={
          staged === null
            ? ''
            : `That file holds ${describeBackup(staged)}. Restoring replaces every record and every document you have now, and it cannot be undone — the history goes with them. Download a backup first if you are not sure.`
        }
        confirmLabel="Replace everything"
        tone="danger"
        onConfirm={() => void onRestore()}
      />
    </>
  )
}

/**
 * The last thing a restore says, held on screen until it is acknowledged.
 *
 * One action. A restore is not undoable — `replaceAll` clears the journal with
 * everything else — so a second button would have to be a lie or a no-op.
 */
function RestoreOutcomeDialog({ report, onDone }: { report: RestoreReport; onDone: () => void }) {
  const summary = restoreSummary(report)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onDone()
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle className={summary.tone === 'danger' ? 'text-danger' : undefined}>
            {summary.title}
          </DialogTitle>
          <DialogDescription>{summary.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={onDone}>Reload jojo</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
