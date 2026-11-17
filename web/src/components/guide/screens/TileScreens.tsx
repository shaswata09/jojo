/**
 * The two sections for the two pages behind the sidebar's status tiles.
 *
 * They are together because that is the only thing they have in common and it
 * is the thing readers get wrong: both are full pages reached from a readout
 * that does not look like a link, and both are fetched separately from the rest
 * of the app.
 */

import { Trans, useTranslation } from 'react-i18next'
import { Address, Go, NotConnected, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import { graphPath, guidePath, settingsPath, transferPath } from '@/lib/links'

const STRONG = <span className="text-text-1" />

/* -------------------------------- graph ----------------------------------- */

export function GraphScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.graph}
      title={t('screens.sections.graph')}
      where={t('screens.graph.where')}
      to={graphPath()}
      open={t('screens.graph.open')}
    >
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="screens.graph.intro"
          components={{ guide: <Go to={guidePath('graph')} /> }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.notObvious')}</h3>
      <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        <li>{t('screens.graph.items.legend')}</li>
        <li>
          <Trans t={t} i18nKey="screens.graph.items.illustrative" components={{ strong: STRONG }} />
        </li>
        <li>{t('screens.graph.items.fetched')}</li>
      </ul>

      <Address i18nKey="screens.graph.address" />
    </Screen>
  )
}

/* ------------------------------ transfer ---------------------------------- */

export function TransferScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.transfer}
      title={t('screens.sections.transfer')}
      where={t('screens.transfer.where')}
      to={transferPath()}
      open={t('screens.transfer.open')}
    >
      <p className="text-sm text-text-2">{t('screens.transfer.intro')}</p>

      <NotConnected title={t('screens.transfer.notConnectedTitle')}>
        <Trans
          t={t}
          i18nKey="screens.transfer.notConnected"
          components={{ settings: <Go to={settingsPath()} /> }}
        />
      </NotConnected>

      <ul className="mt-3.5 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        <li>{t('screens.transfer.items.files')}</li>
        <li>{t('screens.transfer.items.animation')}</li>
        <li>{t('screens.transfer.items.empty')}</li>
      </ul>

      <Address i18nKey="screens.parts.addressNothing" />
    </Screen>
  )
}
