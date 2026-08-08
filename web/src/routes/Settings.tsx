import { useState } from 'react'
import { Download, TriangleAlert, Upload } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { RobotMascot } from '@/components/brand/RobotMascot'
import { Field, SettingRow } from '@/components/common/Field'
import { GESTURES, useMascot } from '@/lib/mascot-context'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { isSoundEnabled, playSwitchClick, setSoundEnabled } from '@/lib/sound'
import { isStorageAvailable } from '@/lib/storage'
import { useTheme, type ThemePref } from '@/lib/theme-context'

const THEMES = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
] as const satisfies readonly { value: ThemePref; label: string }[]

export function Settings() {
  const { pref, setPref } = useTheme()
  const { pose, seq, play } = useMascot()
  const [autoSync, setAutoSync] = useState(true)
  const [snapshots, setSnapshots] = useState(true)
  const [watchFolder, setWatchFolder] = useState(false)
  const [sound, setSound] = useState(isSoundEnabled)

  // Reported, not assumed. jojo is local-first, so this is load-bearing.
  const storageOk = isStorageAvailable()

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
            This browser is blocking local storage, so nothing can be saved. Private windows and
            some managed browsers do this. jojo will work for this session only.
          </p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint="optional">Localhost bridge</PanelTitle>
          <p className="mb-3 text-sm text-text-2">
            Mirrors your data to a JSON file on disk and keeps submission snapshots.
          </p>
          <div className="space-y-3">
            <Field label="Endpoint" defaultValue="http://localhost:7423" mono />
            <Field label="Pairing token" type="password" defaultValue="••••-••••-4F2A" mono />
            <Field label="Data file" defaultValue="~/jobsearch/jojo-data.json" mono />
          </div>
          <div className="mt-4">
            <SettingRow
              label="Auto sync"
              description="Write changes to disk as you work"
              control={
                <Switch checked={autoSync} onCheckedChange={setAutoSync} aria-label="Auto sync" />
              }
            />
            <SettingRow
              label="Save submission snapshots"
              description="Keep a timestamped copy of exactly what you sent"
              control={
                <Switch
                  checked={snapshots}
                  onCheckedChange={setSnapshots}
                  aria-label="Save submission snapshots"
                />
              }
            />
            <SettingRow
              label="Watch materials folder"
              description="Pick up document edits automatically"
              control={
                <Switch
                  checked={watchFolder}
                  onCheckedChange={setWatchFolder}
                  aria-label="Watch materials folder"
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
            <Button variant="outline" size="sm" disabled title="Needs the bridge client">
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
              <div className="flex max-w-72 flex-wrap justify-end gap-1.5">
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
          <Button variant="outline" size="sm" disabled title="Export needs the local store">
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            Export jojo-data.json
          </Button>
          <Button variant="outline" size="sm" disabled title="Export needs the local store">
            <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
            Export to Excel
          </Button>
          <Button variant="outline" size="sm" disabled title="Import needs the local store">
            <Upload className="size-3.5" strokeWidth={1.8} aria-hidden />
            Import
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning">
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <p>
            Everything lives in this browser. Clearing site data erases it. Keep the bridge sync on,
            or export regularly — that one file is your whole profile, and importing it on another
            machine moves everything.
          </p>
        </div>
      </Panel>
    </>
  )
}
