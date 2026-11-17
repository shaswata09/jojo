import { intlLocale } from '@jojo/service/core/intl-locale'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { SettingRow } from '@/components/common/Field'
import { totalOf, type TransferGroup } from '@/components/transfer-ui/groups'
import { Switch } from '@/components/ui/switch'

/**
 * What is about to move, and where.
 *
 * This card used to be a second copy of the pairing code. It is not needed there
 * any more — the code is beside the copy on the stage card, which is where a
 * person is already looking — and a card whose only job was to duplicate something is a
 * card that can say something instead.
 *
 * What it says is the set of facts somebody weighing "should I do this" actually
 * wants, and each one is true rather than reassuring:
 *
 *   - the size, because a transfer of eleven megabytes over wifi is a different
 *     proposition from one of ninety kilobytes
 *   - that it is encrypted, and with a key that came off the screen rather than
 *     off the network
 *   - that it goes to a private address and never touches the internet, which is
 *     the honest form of the promise — see `isPrivateAddress` for why "your
 *     wifi" is a stronger claim than any check can back
 *
 * Deliberately not here: a progress bar. `ConnectPanel` owns the run, and two
 * places describing one transfer is the confusion this page keeps having to
 * clear up.
 */
export function DetailsPanel({
  groups,
  paired,
  target,
}: {
  groups: readonly TransferGroup[]
  /** True once a device has proved it read the code. */
  paired: boolean
  /** Where it is going, once that is known. */
  target: string | null
}) {
  const { t, i18n } = useTranslation('transfer')
  const records = totalOf(groups)

  return (
    <Panel>
      <PanelTitle hint={t('details.hint')}>{t('details.title')}</PanelTitle>
      <SettingRow
        label={t('details.records')}
        description={t('details.recordsHint')}
        control={
          <span className="tabular text-sm text-text-1">
            {records.toLocaleString(intlLocale(i18n.language))}
          </span>
        }
      />
      <SettingRow
        label={t('details.encryption')}
        description={t('details.encryptionHint')}
        control={
          <span className="text-sm text-text-1">
            {paired ? t('details.keyAgreed') : t('details.notPaired')}
          </span>
        }
      />
      <SettingRow
        label={t('details.route')}
        description={t('details.routeHint')}
        control={
          <span className="tabular text-sm text-text-1">{target ?? t('details.localNetwork')}</span>
        }
      />
      <SettingRow
        label={t('details.servers')}
        description={t('details.serversHint')}
        control={<span className="text-sm text-text-1">{t('details.none')}</span>}
      />
    </Panel>
  )
}

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
  const { t } = useTranslation('transfer')
  return (
    <Panel>
      <SettingRow
        label={t('payload.label')}
        description={
          fileCount === 0 ? t('payload.noFiles') : t('payload.files', { count: fileCount })
        }
        control={
          <Switch
            checked={sendFiles && fileCount > 0}
            disabled={locked || fileCount === 0}
            onCheckedChange={onToggleFiles}
            aria-label={t('payload.label')}
          />
        }
      />
    </Panel>
  )
}
