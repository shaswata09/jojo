import { RefreshCw } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { SettingRow } from '@/components/common/Field'
import { SchematicCode } from '@/components/transfer-ui/SchematicCode'
import { formatCode } from '@/components/transfer-ui/pairing'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'

/** The code, the drawing of it, and the one-line answer to "who else sees this". */
export function CodePanel({
  code,
  locked,
  onRegenerate,
}: {
  code: string
  /** True once a run is under way — the code the other device holds cannot change. */
  locked: boolean
  onRegenerate: () => void
}) {
  return (
    <Panel>
      <PanelTitle hint="on this device">Pairing code</PanelTitle>
      <div className="flex flex-col items-center gap-4">
        <SchematicCode code={code} />
        <div className="text-center">
          <p
            className="tabular font-mono text-xl tracking-[0.18em] text-text-1"
            aria-label={`Pairing code ${formatCode(code).split('').join(' ')}`}
          >
            {formatCode(code)}
          </p>
          <p className="mt-1 text-xs text-text-3">
            Type this into the other device. It is the way in for a device with no camera, and the
            way in here.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={locked}
          title={locked ? 'The other device already has this code' : 'Draw a new code'}
          onClick={onRegenerate}
        >
          <RefreshCw className="size-3.5" strokeWidth={1.8} aria-hidden />
          New code
        </Button>
      </div>
      <p className="mt-4 border-t border-hairline pt-3 text-xs text-text-3">
        Is this safe? Only your two devices are ever involved: the code pairs them directly on your
        own network, and there is no jojo server for your records to pass through. In this build
        nothing is sent at all.
      </p>
    </Panel>
  )
}

/**
 * The one choice worth making before a handoff.
 *
 * This was four switches over every record group. The records are the point of
 * the transfer — nobody opens this screen to send some of them — so choosing
 * per group was four decisions to reach the default. Files are the exception:
 * they are the bulk, and the one thing a person might reasonably want to leave
 * behind on a slow link, so that is the switch that survived.
 *
 * Off by default, deliberately. The heavier, slower half of a transfer should
 * be something you opt into rather than something you discover afterwards.
 */
export function PayloadPanel({
  sendFiles,
  onToggleFiles,
  locked,
  fileCount,
}: {
  sendFiles: boolean
  onToggleFiles: (on: boolean) => void
  /** True once a run is under way — what is moving cannot change mid-flight. */
  locked: boolean
  fileCount: number
}) {
  return (
    <Panel>
      <SettingRow
        label="Transfer files"
        description={
          fileCount === 0
            ? 'No files on this device'
            : `${fileCount} file${fileCount === 1 ? '' : 's'} — the slowest part of a handoff`
        }
        control={
          <Switch
            checked={sendFiles && fileCount > 0}
            disabled={locked || fileCount === 0}
            onCheckedChange={onToggleFiles}
            aria-label="Transfer files"
          />
        }
      />
    </Panel>
  )
}
