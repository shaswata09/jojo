import { useState } from 'react'
import { Link } from 'react-router'
import { Download, RotateCcw, Share2, Trash2, TriangleAlert, Upload } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Field, SettingRow } from '@/components/common/Field'
import { KeywordManager } from '@/components/common/KeywordManager'
import { GESTURES, useMascot } from '@/lib/mascot-context'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isSoundEnabled, playSwitchClick, setSoundEnabled } from '@/lib/sound'
import { clearSiteData, isStorageAvailable } from '@/lib/storage'
import { useStoreAdmin } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { useTheme, type ThemePref } from '@/lib/theme-context'
import { transferPath, useTitle } from '@/lib/links'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemePref; label: string }[]

const DATA_SETS = [
  { value: 'demo', label: 'Demo data' },
  { value: 'empty', label: 'Empty' },
] as const
type DataSet = (typeof DATA_SETS)[number]['value']

/** Which destructive data action is waiting on a confirmation. */
type PendingData = 'demo' | 'empty' | 'reset' | 'storage'

export function Settings() {
  useTitle('Settings')
  const { pref, setPref } = useTheme()
  const { pose, seq, play } = useMascot()
  const { exportJSON, reset, clearAll, isEmpty } = useStoreAdmin()
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

  /**
   * Writes the store to a file the browser downloads.
   *
   * A Blob URL pins its data in memory until it is revoked, so the handle is
   * released as soon as the click has been dispatched — otherwise every export
   * would leak a copy of the whole store for the life of the tab.
   */
  const onExport = () => {
    const blob = new Blob([exportJSON()], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = 'jojo-data.json'
    anchor.click()
    URL.revokeObjectURL(href)
    toast({ title: 'Exported', description: 'jojo-data.json was written to your downloads.' })
  }

  /**
   * The seeded records are the only thing standing between a first-time reader
   * and every empty state in the app, and until now they could not be moved:
   * the store is reseeded on every load, so "what does this look like before I
   * have anything" was unanswerable without editing the source.
   *
   * All three writes replace or delete records the user may have authored, and
   * none of them is undoable — the reducer has a reset and a clear, and no
   * restore between them — so each goes through a confirmation rather than an
   * undo toast. Say it in the dialog, and say it again in the toast.
   */
  const dataSet: DataSet = isEmpty ? 'empty' : 'demo'

  /**
   * Empties the browser, then the tab.
   *
   * The store is cleared too. Wiping the preferences while twelve applications
   * stayed on screen would make the confirmation's own wording false — and the
   * records are the thing a person means when they say "clear everything".
   *
   * The theme is deliberately NOT reset in memory afterwards. The stored
   * preference is gone, so a reload picks up the system setting; repainting the
   * page a different colour under someone who just pressed a button about
   * storage would read as a fault rather than as the point.
   */
  const onClearStorage = async () => {
    setClearing(true)
    try {
      const cleared = await clearSiteData()
      clearAll()
      const parts = [
        `${cleared.localStorage + cleared.sessionStorage} stored preferences`,
        cleared.indexedDBUnknown
          ? 'databases could not be listed by this browser'
          : `${cleared.indexedDB} databases`,
        `${cleared.caches} caches`,
        `${cleared.cookies} cookies`,
      ]
      toast({
        title: 'Browser storage cleared',
        description: `${parts.join(' · ')}. Every record in this tab is gone too.`,
        tone: 'danger',
      })
    } finally {
      // In a finally: a browser that blocks one of the stores throws past the
      // await, and a button stuck reading "Clearing…" would be the only thing
      // left to tell the user what happened.
      setClearing(false)
    }
  }

  const applyPending = () => {
    if (pending === 'storage') {
      void onClearStorage()
      return
    }
    if (pending === 'empty') {
      clearAll()
      toast({
        title: 'Everything cleared',
        description:
          'Every record is gone, your profile included. Load the demo data again from here.',
        tone: 'danger',
      })
      return
    }
    reset()
    toast({
      title: pending === 'reset' ? 'Demo data reset' : 'Demo data loaded',
      description:
        'The seeded applications, timeline, vault, postings and profile are back as they shipped.',
    })
  }

  const pendingCopy: Record<PendingData, { title: string; description: string; confirm: string }> =
    {
      empty: {
        title: 'Clear every record?',
        description:
          'Applications, the timeline, the vault, saved postings and your profile all go, including anything you added this session. There is no undo — export first if you want them back. Your keywords are kept — they live in their own store — but nothing is left carrying them, so every count in the keyword panel goes to zero.',
        confirm: 'Clear everything',
      },
      demo: {
        title: 'Load the demo data?',
        description:
          'The seeded records come back, tagged with the keywords they shipped with. Anything you have added this session is replaced, not merged, and there is no undo.',
        confirm: 'Load demo data',
      },
      reset: {
        title: 'Reset to the demo data?',
        description:
          'Every edit, addition and deletion from this session is discarded and the seeded records come back exactly as they shipped, tagged as they shipped. Your keyword list itself is left alone. There is no undo.',
        confirm: 'Reset data',
      },
      // Says what it reaches AND what it cannot. jojo has no server, so a
      // dialog offering to clear one would be inventing a thing to reassure
      // the reader about; the honest version is that there is nothing there.
      storage: {
        title: 'Clear everything this site has stored?',
        description:
          'Empties this browser of everything jojo has put in it — your theme and sound preferences, any databases, caches and cookies — and clears the records held in this tab. There is no server holding a copy, and nothing here has ever left this machine, so this is all of it. There is no undo: export first if you want your records back.',
        confirm: 'Clear storage',
      },
    }

  return (
    <>
      <PageHeader title="Settings" subtitle="Connections, sync and your data" />

      {!storageOk ? (
        <div
          role="alert"
          className="flex items-start gap-2.5 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <p>
            This browser is blocking local storage. Nothing in this build depends on it yet — the
            store is in memory either way — but persistence cannot be turned on here until the block
            is lifted. Private windows and some managed browsers do this.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="optional">Save to a file on this computer</PanelTitle>
          <p className="mb-3 text-sm text-text-2">
            jojo works fully without this. Set up later and it also keeps a copy of your records in
            a file you own, so they survive closing the tab. Nothing connects to these fields yet.
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
            title="The store can be read but not yet replaced, so an import would have nowhere to land"
          >
            <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
            Import
          </Button>
        </div>
        <p className="mt-2 text-xs text-text-3">
          The export covers applications, the timeline, the vault, saved postings and your profile.
          Keywords live in their own store and are not in it yet — the panel below manages those.
        </p>

        <div className="mt-4">
          <SettingRow
            label="Records"
            description={
              isEmpty
                ? 'Every list is empty, so every page is showing its first-run state.'
                : 'The seeded search — twelve applications, a timeline, a stocked vault.'
            }
            control={
              <Segment
                label="Records"
                options={DATA_SETS}
                value={dataSet}
                // The segment reflects the store rather than a local flag, so it
                // does not flip until the confirmation behind it has been taken.
                onChange={(next) => setPending(next === 'empty' ? 'empty' : 'demo')}
              />
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
            description="Empties everything this site has stored in your browser — preferences, databases, caches and cookies — and the records held in this tab."
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
          <SettingRow
            label="Reset the demo data"
            description="Puts back everything as it shipped, discarding this session's edits."
            control={
              <Button
                variant="outline"
                size="sm"
                disabled={isEmpty}
                title={
                  isEmpty
                    ? 'Nothing to reset — switch Records back to Demo data first'
                    : 'Discard this session and reseed'
                }
                onClick={() => setPending('reset')}
              >
                <RotateCcw className="size-3.5" strokeWidth={1.8} aria-hidden />
                Reset
              </Button>
            }
          />
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <p>
            Nothing is written to disk in this build — the store lives in memory for as long as the
            tab is open, so a reload puts the demo data back and takes your changes with it. Export
            before you close it. With the bridge running, the same file would be kept in step as you
            work.
          </p>
        </div>
      </Panel>

      <KeywordManager />

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
