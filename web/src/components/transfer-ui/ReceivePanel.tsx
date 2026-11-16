import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowDown, Download, Loader } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { restoreSummary } from '@/components/settings/restore-report'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { sizeLabel } from '@jojo/service/core/files'
import { canReachLocalNetwork } from '@/lib/handoff-client'
import { pullConfirmCopy, type PullState } from '@/lib/handoff-pull'
import { settingsPath } from '@/lib/links'

/**
 * Receiving the phone's records on this computer.
 *
 * ## What this used to say
 *
 * "Not possible in a browser", with a link to the backup file. Half of that
 * was right: a web page cannot accept a connection, so a phone can never
 * connect TO this computer. The conclusion did not follow. The phone already
 * listens on the local network for the other direction, and a page that can
 * connect to it can ask it for its records as easily as it can post its own —
 * so the phone serves its backup in sealed chunks and this computer pulls them.
 * See `lib/handoff-pull.ts` and `core/handoff-pull.ts`.
 *
 * ## The steps, and the one the person does
 *
 * The phone reads the animation on the left, which agrees a key. It then shows
 * its address as twelve characters, typed here, because a browser cannot find
 * a device on the network by itself. Everything else is jojo's.
 *
 * ## Where it ends
 *
 * Where a backup file ends: behind the same "replace everything" confirmation,
 * through the same restore, onto the same dialog that reloads the page. What
 * arrived is checked in full before that question is asked, and nothing here
 * changes until it is answered.
 */
export function ReceivePanel({ pull, tokens }: { pull: PullState; tokens: readonly string[] }) {
  const [code, setCode] = useState('')
  const able = canReachLocalNetwork()
  const busy =
    pull.stage === 'connecting' ||
    pull.stage === 'receiving' ||
    pull.stage === 'confirming' ||
    pull.stage === 'restoring'
  const confirmCopy = pull.plan === null ? null : pullConfirmCopy(pull.plan)

  return (
    <>
      <Panel>
        <PanelTitle hint="from your phone">Receive from phone</PanelTitle>

        {!able ? (
          <p className="text-sm text-text-2">
            This browser cannot connect to another device on your network — Safari and every browser
            on an iPhone or iPad cannot, and nor can Firefox from the published site. Use Chrome or
            Edge on a computer — or export a backup on your phone and open it under Settings.
          </p>
        ) : (
          <>
            <p className="mb-3 text-sm text-text-2">
              On your phone, open Transfer, choose Send to a computer, and point it at the
              animation. It then shows a short code — type it here. Both devices need to be on the
              same local network.
            </p>

            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="K3M9-2XQ7-4B1P"
                spellCheck={false}
                autoCapitalize="characters"
                autoComplete="off"
                className="tabular font-mono tracking-[0.12em]"
                aria-label="The code shown on your phone"
                disabled={busy}
              />
              <Button
                size="sm"
                disabled={busy || tokens.length === 0 || code.trim().length === 0}
                onClick={() => {
                  if (tokens.length > 0) void pull.start(code, tokens)
                }}
              >
                {busy ? (
                  <Loader className="size-3.5 animate-spin" strokeWidth={1.8} aria-hidden />
                ) : (
                  <ArrowDown className="size-3.5" strokeWidth={1.8} aria-hidden />
                )}
                Receive
              </Button>
            </div>

            {/* Bytes, not a percentage: the phone does not say how much is
                coming, and a bar that guessed would be the kind of progress
                this page stopped showing. */}
            {pull.stage === 'connecting' || pull.stage === 'receiving' ? (
              <div className="mt-3 flex items-start justify-between gap-2">
                <p className="text-xs text-text-3" role="status">
                  {pull.stage === 'connecting'
                    ? 'Reaching your phone…'
                    : `${sizeLabel(pull.bytes)} received so far. Nothing here changes until you agree to it.`}
                </p>
                {/* Always a way out — a phone that went quiet used to leave
                    this waiting with nothing to press. */}
                <Button size="xs" variant="ghost" onClick={pull.cancel}>
                  Cancel
                </Button>
              </div>
            ) : null}
            {pull.stage === 'restoring' ? (
              <p className="mt-3 text-xs text-text-3" role="status">
                Replacing the records on this computer…
              </p>
            ) : null}

            {pull.problem === null ? null : (
              <p className="mt-3 text-sm text-warning">{pull.problem}</p>
            )}
          </>
        )}

        {/* Before the field's consequences rather than after them. A restore
            replaces the store wholesale and clears the history, so the time
            to keep a copy of what is here is before the phone is dialled. */}
        <p className="mt-4 text-xs text-text-3">
          Receiving replaces everything on this computer with what is on your phone, once you agree
          to it. To keep a copy of what is here, download a backup first.
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={settingsPath()}>
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              Download a backup first
            </Link>
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint="between two computers">Two browsers</PanelTitle>
        <p className="text-sm text-text-2">
          A web page cannot accept a connection, and neither can the other computer&rsquo;s, so two
          computers cannot connect to each other. Export a backup from one and open it on the other
          — it carries every record and every document.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={settingsPath()}>
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              Export a backup
            </Link>
          </Button>
        </div>
      </Panel>

      {/* The question a backup file asks, about what the phone sent. */}
      <ConfirmDialog
        open={confirmCopy !== null}
        onOpenChange={(open) => {
          if (!open && pull.stage === 'confirming') pull.decline()
        }}
        title={confirmCopy?.title ?? ''}
        description={confirmCopy?.description ?? ''}
        confirmLabel={confirmCopy?.confirm ?? 'Replace everything'}
        tone="danger"
        onConfirm={() => void pull.confirm()}
      />

      {/* What the restore did, and the only way off it is the reload — as on
          Settings, because every projection behind it describes a store that
          no longer exists. */}
      {pull.outcome === null ? null : (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) window.location.reload()
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle
                className={
                  restoreSummary(pull.outcome).tone === 'danger' ? 'text-danger' : undefined
                }
              >
                {restoreSummary(pull.outcome).title}
              </DialogTitle>
              <DialogDescription>{restoreSummary(pull.outcome).description}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => window.location.reload()}>Reload jojo</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
