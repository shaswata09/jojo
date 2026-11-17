/**
 * The Applications section, on its own because it is the longest on the page.
 *
 * It is one of the six the sidebar lists — the rest are in `SidebarScreens.tsx`
 * — and it is here rather than with them because it is three sections' worth of
 * material under one heading: the two layouts, moving a card between stages,
 * and the record itself.
 */

import { Trans, useTranslation } from 'react-i18next'
import { Address, Code, Go, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import { applicationsPath, guidePath } from '@/lib/links'

const STRONG = <span className="text-text-1" />
const CODE = <Code />

const BOARD_ITEMS = ['columns', 'sort', 'chips', 'search', 'empty'] as const
const RECORD_ITEMS = ['opens', 'address', 'note', 'delete', 'deleted'] as const

export function ApplicationsScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.applications}
      title={t('screens.sections.applications')}
      where={t('screens.applications.where')}
      to={applicationsPath()}
      open={t('screens.applications.open')}
    >
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="screens.applications.intro"
          components={{ overview: <Go to={guidePath('overview')} /> }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.applications.boardTitle')}</h3>
      <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        {BOARD_ITEMS.map((item) => (
          <li key={item}>
            <Trans
              t={t}
              i18nKey={`screens.applications.board.${item}`}
              components={{ strong: STRONG }}
            />
          </li>
        ))}
      </ul>

      <h3 className="mt-4 text-sm font-medium">{t('screens.applications.moveTitle')}</h3>
      <p className="mt-1 text-sm text-text-2">{t('screens.applications.move')}</p>
      <dl className="mt-3 divide-y divide-hairline text-sm">
        {(['fromBoard', 'fromRecord'] as const).map((from) => (
          <div key={from} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
            <dt className="basis-44 font-medium">{t(`screens.applications.${from}.name`)}</dt>
            <dd className="min-w-0 flex-1 basis-64 text-text-2">
              {t(`screens.applications.${from}.body`)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-sm text-text-2">
        <Trans t={t} i18nKey="screens.applications.exits" components={{ strong: STRONG }} />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.applications.recordTitle')}</h3>
      <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        {RECORD_ITEMS.map((item) => (
          <li key={item}>
            <Trans
              t={t}
              i18nKey={`screens.applications.record.${item}`}
              components={{ code: CODE }}
            />
          </li>
        ))}
      </ul>

      {/* The offer link read "everything at offer" while landing on
          everything: `applicationsPath({ stage: 'offer' })` omits `view`,
          which defaults to the board, and the board draws `pool` — filtered
          by the search, the role and the keyword selections, never by the
          stage, because it is already grouped into stage columns. Only
          `tableRows` narrows by `stageFilter` and only the table renders the
          stage chips, so the filter went nowhere and the page read 12 shown
          of 12 under a label promising one. Naming the table is the fix. The
          same defect was found and fixed on `GuideOverview.tsx` first; it was
          reintroduced here by copying the sentence rather than the URL. */}
      <Address
        i18nKey="screens.applications.address"
        components={{
          bystage: <Go to={applicationsPath({ view: 'table', sort: 'stage' })} />,
          atoffer: <Go to={applicationsPath({ view: 'table', stage: 'offer' })} />,
        }}
      />
    </Screen>
  )
}
