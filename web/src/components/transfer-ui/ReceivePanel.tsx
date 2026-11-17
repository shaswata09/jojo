import { useState } from 'react'
import { useTranslation } from 'react-i18next'
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
 * The phone scans the code on the left, which agrees a key. It then shows
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
  const { t } = useTranslation('transfer')
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
        <PanelTitle hint={t('receive.hint')}>{t('receive.title')}</PanelTitle>

        {!able ? (
          <p className="text-sm text-text-2">{t('receive.unable')}</p>
        ) : (
          <>
            <p className="mb-3 text-sm text-text-2">{t('receive.intro')}</p>

            <div className="flex gap-2">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="K3M9-2XQ7-4B1P"
                spellCheck={false}
                autoCapitalize="characters"
                autoComplete="off"
                className="tabular font-mono tracking-[0.12em]"
                aria-label={t('receive.codeLabel')}
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
                {t('receive.receive')}
              </Button>
            </div>

            {/* Bytes, not a percentage: the phone does not say how much is
                coming, and a bar that guessed would be the kind of progress
                this page stopped showing. */}
            {pull.stage === 'connecting' || pull.stage === 'receiving' ? (
              <div className="mt-3 flex items-start justify-between gap-2">
                <p className="text-xs text-text-3" role="status">
                  {pull.stage === 'connecting'
                    ? t('receive.reaching')
                    : t('receive.progress', { size: sizeLabel(pull.bytes) })}
                </p>
                {/* Always a way out — a phone that went quiet used to leave
                    this waiting with nothing to press. */}
                <Button size="xs" variant="ghost" onClick={pull.cancel}>
                  {t('receive.cancel')}
                </Button>
              </div>
            ) : null}
            {pull.stage === 'restoring' ? (
              <p className="mt-3 text-xs text-text-3" role="status">
                {t('receive.restoring')}
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
        <p className="mt-4 text-xs text-text-3">{t('receive.replaceWarning')}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={settingsPath()}>
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              {t('receive.downloadFirst')}
            </Link>
          </Button>
        </div>
      </Panel>

      <Panel>
        <PanelTitle hint={t('receive.twoBrowsers.hint')}>
          {t('receive.twoBrowsers.title')}
        </PanelTitle>
        <p className="text-sm text-text-2">{t('receive.twoBrowsers.body')}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          <Button variant="outline" size="sm" asChild>
            <Link to={settingsPath()}>
              <Download className="size-3.5" strokeWidth={1.8} aria-hidden />
              {t('receive.twoBrowsers.export')}
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
        confirmLabel={confirmCopy?.confirm ?? t('pullConfirm.confirm')}
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
              <Button onClick={() => window.location.reload()}>{t('receive.reload')}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
