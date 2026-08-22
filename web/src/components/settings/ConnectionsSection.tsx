import { useState } from 'react'
import { Chip } from '@/components/common/Chip'
import { Field, SettingRow } from '@/components/common/Field'
import { FolderPicker } from '@/components/settings/FolderPicker'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/**
 * The two things jojo could talk to and does not: a file on this computer, and
 * a local model. Nothing here is wired up — every control says so in its own
 * copy, and the switches are the honest half of that.
 */
export function ConnectionsSection() {
  // All three start off. They were on by default in a panel whose own copy says
  // nothing is connected — and in an app whose promise is that your data stays
  // on your machine, a switch that claims to be writing files somewhere is the
  // single most consequential thing a person could be wrong about. Off is both
  // true and the safe reading.
  const [autoSync, setAutoSync] = useState(false)
  const [snapshots, setSnapshots] = useState(false)
  const [watchFolder, setWatchFolder] = useState(false)

  return (
    <div className="grid grid-cols-1 gap-4 sm:gap-5 lg:grid-cols-2">
      <Panel>
        <PanelTitle hint="optional">Save to a file on this computer</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          jojo works fully without this. Your records are already saved in this browser; choose a
          folder and it also keeps a copy in files you own, outside the browser. The bridge fields
          below are not connected yet — the folder is.
        </p>
        <div className="space-y-3">
          {/* "Bridge" is load-bearing since Transfer arrived: that page also
              shows a "Pairing code", and it means something else entirely —
              one pairs this tab with a helper process on this machine, the
              other pairs this device with a second one. Two identical labels
              for two different secrets is how someone ends up typing the
              wrong one into the wrong field. */}
          <Field label="Bridge pairing code" type="password" defaultValue="••••-••••-4F2A" mono />
          <FolderPicker />
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
  )
}
