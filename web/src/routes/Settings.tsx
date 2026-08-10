import { useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Download, Share2, Sparkles, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { AuditLog } from '@/components/common/AuditLog'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Diagnostics } from '@/components/common/Diagnostics'
import { Field, SettingRow } from '@/components/common/Field'
import { KeywordManager } from '@/components/common/KeywordManager'
import { useStoreAdmin } from '@/kg/react/use-admin'
import { GESTURES, useMascot } from '@/lib/mascot-context'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { useBoot } from '@/lib/boot-context'
import { isSoundEnabled, playSwitchClick, setSoundEnabled } from '@/lib/sound'
import { clearSiteData, isStorageAvailable } from '@/lib/storage'
import { useToast } from '@/lib/toast-context'
import { useTheme, type ThemePref } from '@/lib/theme-context'
import { transferPath, useTitle } from '@/lib/links'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemePref; label: string }[]

/**
 * Which destructive data action is waiting on a confirmation.
 *
 * `reset` is gone, and it was never a third thing. It ran `memory.reset` — the
 * same write as *Demo data*, described in a different tense ("put the seeded
 * records back" against "load the seeded records"), and which of the two a user
 * got depended on whether the store happened to be empty when they arrived. One
 * button, named for what it does to their records, is the version that can be
 * read without already knowing the answer.
 */
type PendingData = 'demo' | 'empty' | 'storage'

export function Settings() {
  useTitle('Settings')
  const { pref, setPref } = useTheme()
  const { pose, seq, play } = useMascot()
  const { exportJSON, clearAll, isEmpty, dataSet } = useStoreAdmin()
  const { state, closeStore, chooseDataSet, busy } = useBoot()
  const { toast } = useToast()
  // All three start off. They were on by default in a panel whose own copy says
  // nothing is connected — and in an app whose promise is that your data stays
  // on your machine, a switch that claims to be writing files somewhere is the
  // single most consequential thing a person could be wrong about. Off is both
  // true and the safe reading.
  const [autoSync, setAutoSync] = useState(false)
  const [snapshots, setSnapshots] = useState(false)
  const [watchFolder, setWatchFolder] = useState(false)
  const [sound, setSound] = useState(isSoundEnabled)
  const [pending, setPending] = useState<PendingData | null>(null)
  const [clearing, setClearing] = useState(false)

  // Reported, not assumed. jojo is local-first, so this is load-bearing.
  const storageOk = isStorageAvailable()
  /** Whether the records themselves are on disk. Not the same question as above. */
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
   */
  const onExport = () => {
    const name = `jojo-backup-${new Date().toISOString().slice(0, 10)}.json`
    const blob = new Blob([exportJSON()], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = name
    anchor.click()
    URL.revokeObjectURL(href)
    toast({ title: 'Exported', description: `${name} was written to your downloads.` })
  }

  /**
   * Nothing in this store is the user's yet.
   *
   * `dataSet` flips to 'user' on the first commit they make (`meta.ts:109`), so
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

  /**
   * The export, offered inside the confirmation rather than only in the panel
   * behind it.
   *
   * This is the last moment it is worth anything: the dialog is open because the
   * user is about to replace or delete every record in the store, and "you should
   * have exported first" is a sentence that can only be said afterwards. It does
   * not close the dialog — the download starts, the toast fires, and the
   * confirmation is still there to be taken or cancelled.
   *
   * `flex w-fit` rather than the default inline-flex: this renders inside
   * `DialogDescription`, which is a `<p>`, so an inline button lands at the end
   * of the last line of prose looking like a word that grew a border.
   */
  const exportFirst = (
    <Button variant="outline" size="sm" className="mt-3 flex w-fit" onClick={onExport}>
      <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
      Export a backup first
    </Button>
  )

  const pendingCopy: Record<
    PendingData,
    { title: string; description: ReactNode; confirm: string }
  > = {
    empty: {
      title: 'Clear every record?',
      description: (
        <>
          {untouchedDemo
            ? `The demo applications, timeline, vault, saved postings, keywords and profile all go, ${persists}. Nothing here was yours — this store has not been written to since the demo data was loaded.`
            : `Applications, the timeline, the vault, saved postings and your profile all go, including anything you added this session, ${persists}. There is no undo. Your keywords are kept — they are records of their own — but nothing is left carrying them, so every count in the keyword panel goes to zero.`}
          {untouchedDemo ? null : exportFirst}
        </>
      ),
      confirm: 'Clear everything',
    },
    demo: {
      title: 'Load the demo data?',
      description: (
        <>
          {isEmpty
            ? `Twelve applications, a timeline, a stocked vault and a profile${durable ? ' are written to your database' : ' are loaded'}, tagged with the keywords they shipped with. Clearing them again is one press.`
            : 'Everything in jojo is replaced by the seeded records — your applications, timeline, vault, saved postings, keywords and profile, all of it, replaced rather than merged. There is no undo.'}
          {isEmpty ? null : exportFirst}
        </>
      ),
      confirm: 'Load demo data',
    },
    // Says what it reaches AND what it cannot. jojo has no server, so a
    // dialog offering to clear one would be inventing a thing to reassure
    // the reader about; the honest version is that there is nothing there.
    storage: {
      title: 'Clear everything this site has stored?',
      description: (
        <>
          Empties this browser of everything jojo has put in it — your records and their database,
          your theme and sound preferences, any caches and cookies — and then reloads. There is no
          server holding a copy, and nothing here has ever left this machine, so this is all of it.
          jojo comes back as it would on a new machine: the system theme, and the question it asks
          on a first run about whether to start with the demo data or empty. There is no undo.
          {exportFirst}
        </>
      ),
      confirm: 'Clear storage',
    },
  }

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections, sync and your data" />

      {/* Two different questions, and they used to be conflated. This one is
          about `localStorage`, which holds the theme and the sound switch; the
          records live in IndexedDB, whose state is the banner at the top of every
          page and the Diagnostics panel below. The old copy said "nothing in this
          build depends on it yet — the store is in memory either way", which
          stopped being true the moment the store went to disk. */}
      {!storageOk ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <p>
            This browser is blocking site storage, so your theme and sound preferences are not
            remembered between visits. Private windows and some managed browsers do this. Whether
            your records are being saved is a separate question — Diagnostics below answers it.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="optional">Save to a file on this computer</PanelTitle>
          <p className="mb-3 text-sm text-text-2">
            jojo works fully without this. Your records are already saved in this browser; set this
            up later and it also keeps a copy in a file you own, outside the browser, kept in step
            as you work. Nothing connects to these fields yet.
          </p>
          <div className="space-y-3">
            <Field label="Address" defaultValue="http://localhost:7423" mono />
            {/* "Bridge" is load-bearing since Transfer arrived: that page also
                shows a "Pairing code", and it means something else entirely —
                one pairs this tab with a helper process on this machine, the
                other pairs this device with a second one. Two identical labels
                for two different secrets is how someone ends up typing the
                wrong one into the wrong field. */}
            <Field label="Bridge pairing code" type="password" defaultValue="••••-••••-4F2A" mono />
            <Field label="Where to save it" defaultValue="~/jobsearch/jojo-data.json" mono />
          </div>
          <div className="mt-4">
            {/* Named for what happens to the user's records, not for the
                mechanism. "Auto sync" describes an implementation; "save as I
                work" describes the thing being promised, which is what a person
                is actually deciding about. */}
            <SettingRow
              label="Save as I work"
              description="Write every change straight to that file"
              control={
                <Switch
                  checked={autoSync}
                  onCheckedChange={setAutoSync}
                  aria-label="Save as I work"
                />
              }
            />
            <SettingRow
              label="Keep a copy of what I sent"
              description="A timestamped snapshot of each submitted application"
              control={
                <Switch
                  checked={snapshots}
                  onCheckedChange={setSnapshots}
                  aria-label="Keep a copy of what I sent"
                />
              }
            />
            <SettingRow
              label="Notice when my documents change"
              description="Pick up edits to your CV and statements automatically"
              control={
                <Switch
                  checked={watchFolder}
                  onCheckedChange={setWatchFolder}
                  aria-label="Notice when my documents change"
                />
              }
            />
          </div>
        </Panel>

        <Panel>
          <PanelTitle hint="OpenAI-compatible">Local model</PanelTitle>
          <p className="mb-3 text-sm text-text-2">
            Point at any local server: vLLM, Ollama or LM Studio.
          </p>
          <div className="space-y-3">
            <Field label="Endpoint" defaultValue="http://localhost:8000/v1" mono />
            <Field label="Model" defaultValue="llama-3.1-8b-instruct" mono />
          </div>
          <div className="mt-4 flex items-center gap-3">
            {/* The old blocker named the bridge, which is the panel above. The
                real one is nearer than that: this build makes no network
                requests at all, so there is nothing here to test with. */}
            <Button
              variant="outline"
              size="sm"
              disabled
              title="This build makes no network requests, so there is nothing to reach the endpoint with"
            >
              Test connection
            </Button>
            <Chip tone="gray">Not connected</Chip>
          </div>
        </Panel>
      </div>

      <Panel>
        <PanelTitle>Appearance</PanelTitle>
        <SettingRow
          label="Theme"
          description="System follows your operating system setting"
          control={<Segment label="Theme" options={THEMES} value={pref} onChange={setPref} />}
        />
        <SettingRow
          label="Mascot gestures"
          description="jojo reacts as you work. Try one."
          control={
            <div className="flex items-center justify-end gap-3">
              {/* A local preview, rather than telling you to go look at the
                  sidebar — below `lg` the sidebar is a closed drawer, so that
                  instruction would have been a lie on every phone. */}
              {/* Dark plate in both themes, for the same reason favicon.svg has
                  one: the robot is light grey, so on the light theme's #f5f5f5
                  well it would all but disappear. */}
              <span className="grid size-14 shrink-0 place-items-center rounded-md bg-[#171717]">
                <RobotMascot pose={pose} seq={seq} className="size-11" />
              </span>
              {/* Narrower on phones. SettingRow's control cell is `shrink-0`,
                  so whatever this measures is a hard floor for the row — at 72
                  the ten gestures plus the robot plate pushed the Settings page
                  into a sideways scroll. Wrapping into an extra line costs
                  nothing; the page scrolling does not. */}
              <div className="flex max-w-56 flex-wrap justify-end gap-1.5 sm:max-w-72">
                {GESTURES.map(({ pose: g, label }) => (
                  <Button key={g} variant="outline" size="sm" onClick={() => play(g)}>
                    {label}
                  </Button>
                ))}
              </div>
            </div>
          }
        />
        <SettingRow
          label="Interface sounds"
          description="A short click when you flip a switch"
          control={
            <Switch
              checked={sound}
              onCheckedChange={(on) => {
                setSoundEnabled(on)
                setSound(on)
                // Play on enable so you hear exactly what you just turned on.
                if (on) playSwitchClick()
              }}
              aria-label="Interface sounds"
            />
          }
        />
      </Panel>

      <Panel>
        <PanelTitle>Your data</PanelTitle>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={onExport}>
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            Export jojo-data.json
          </Button>
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
            description="Empties everything this site has stored in your browser — your records and their database, preferences, caches and cookies — then reloads jojo as if it were new."
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

      <KeywordManager />

      <Diagnostics />

      <AuditLog />

      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null)
        }}
        title={pending ? pendingCopy[pending].title : 'Change the data?'}
        description={pending ? pendingCopy[pending].description : ''}
        confirmLabel={pending ? pendingCopy[pending].confirm : 'Continue'}
        tone="danger"
        onConfirm={applyPending}
      />
    </>
  )
}
