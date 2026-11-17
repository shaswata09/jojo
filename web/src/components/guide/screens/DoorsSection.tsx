import type { ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Doors } from '@/components/guide/screens/Doors'
import { Code, Go } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import {
  applicationsPath,
  assistantPath,
  calendarPath,
  dashboardPath,
  graphPath,
  guidePath,
  profilePath,
  scoutPath,
  settingsPath,
  statisticsPath,
  transferPath,
  vaultPath,
} from '@/lib/links'

const STRONG = <span className="text-text-1" />
const CODE = <Code />

/**
 * Every route, and the control that opens it. `id` is the section id on this
 * page, which also names the route's label (`screens.sections.<id>`) and where
 * it is reached from (`screens.doors.where.<id>`) in the `guide` catalog.
 */
const DOORS: { id: keyof typeof S; to: string; components?: Record<string, ReactElement> }[] = [
  { id: 'dashboard', to: dashboardPath() },
  { id: 'applications', to: applicationsPath() },
  { id: 'calendar', to: calendarPath() },
  { id: 'vault', to: vaultPath(), components: { code: CODE } },
  { id: 'scout', to: scoutPath() },
  { id: 'statistics', to: statisticsPath() },
  { id: 'graph', to: graphPath(), components: { strong: STRONG } },
  {
    id: 'transfer',
    to: transferPath(),
    components: { strong: STRONG, settings: <Go to={settingsPath()} /> },
  },
  { id: 'profile', to: profilePath() },
  { id: 'assistant', to: assistantPath() },
  { id: 'settings', to: settingsPath(), components: { strong: STRONG } },
  { id: 'guide', to: guidePath() },
]

export function DoorsSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id={S.doors} className="scroll-mt-4">
      <PanelTitle hint={t('screens.doors.hint')}>{t('screens.doors.title')}</PanelTitle>

      <p className="text-sm text-text-2">{t('screens.doors.intro')}</p>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[auto_1fr] lg:gap-6">
        <Doors />

        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('screens.doors.listTitle')}</h3>
          <dl className="mt-2 divide-y divide-hairline text-sm">
            {DOORS.map((door) => (
              <div key={door.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                <dt className="basis-28 font-medium">
                  <Go to={door.to}>{t(`screens.sections.${door.id}`)}</Go>
                </dt>
                <dd className="min-w-0 flex-1 basis-64 text-text-2">
                  <Trans
                    t={t}
                    i18nKey={`screens.doors.where.${door.id}`}
                    components={door.components}
                  />
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="mt-3.5 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="screens.doors.palette"
          components={{
            kbd: <Kbd>{''}</Kbd>,
            strong: STRONG,
            overview: <Go to={guidePath('overview')} />,
          }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.doors.everyTitle')}</h3>
      <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        <li>{t('screens.doors.switches')}</li>
        <li>
          <Trans t={t} i18nKey="screens.doors.defaults" components={{ code: CODE }} />
        </li>
      </ul>
    </Panel>
  )
}
