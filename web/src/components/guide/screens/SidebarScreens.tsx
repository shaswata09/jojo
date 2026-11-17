/**
 * Five of the six sections for the pages the sidebar lists, in sidebar order.
 *
 * Grouped by the door rather than by size, which is the split the `Doors`
 * diagram at the top of the page already argues for: a reader looking for the
 * Calendar section knows it is one of the six in the sidebar before they know
 * anything else about it. Applications is the sixth and is in
 * `ApplicationsScreen.tsx`, being as long as three of these together.
 */

import type { ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Address, Code, Go, NotConnected, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import {
  calendarPath,
  dashboardPath,
  guidePath,
  scoutPath,
  statisticsPath,
  vaultPath,
} from '@/lib/links'

const STRONG = <span className="text-text-1" />
const CODE = <Code />

/**
 * A bulleted list of catalog sentences, each of which may carry `<strong>` and
 * `<code>`, plus whatever links the caller adds.
 */
function Items({
  base,
  items,
  links,
}: {
  base: string
  items: readonly string[]
  links?: Record<string, ReactElement>
}) {
  const { t } = useTranslation('guide')
  return (
    <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
      {items.map((item) => (
        <li key={item}>
          <Trans
            t={t}
            i18nKey={`${base}.${item}`}
            components={{ strong: STRONG, code: CODE, ...links }}
          />
        </li>
      ))}
    </ul>
  )
}

/* ----------------------------- dashboard ---------------------------------- */

export function TodayScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.dashboard}
      title={t('screens.sections.dashboard')}
      where={t('screens.today.where')}
      to={dashboardPath()}
      open={t('screens.today.open')}
    >
      <p className="text-sm text-text-2">
        <Trans t={t} i18nKey="screens.today.intro" components={{ strong: STRONG }} />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.notObvious')}</h3>
      <Items
        base="screens.today.items"
        items={['checklist', 'colour', 'rows', 'strip']}
        links={{ calendar: <Go to={calendarPath()} /> }}
      />

      <Address i18nKey="screens.today.address" components={{ code: CODE }} />
    </Screen>
  )
}

/* ------------------------------ calendar ---------------------------------- */

export function CalendarScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.calendar}
      title={t('screens.sections.calendar')}
      where={t('screens.calendar.where')}
      to={calendarPath()}
      open={t('screens.calendar.open')}
    >
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="screens.calendar.intro"
          components={{ overview: <Go to={guidePath('overview')} /> }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.notObvious')}</h3>
      <Items
        base="screens.calendar.items"
        items={['drag', 'types', 'key', 'goTo', 'paging', 'add', 'export']}
      />

      <Address i18nKey="screens.calendar.address" components={{ code: CODE }} />
    </Screen>
  )
}

/* -------------------------------- vault ----------------------------------- */

/** The six tools in the order the segmented control shows them. */
const VAULT_TOOLS = ['reminders', 'links', 'files', 'snippets', 'people', 'tools'] as const

export function VaultScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.vault}
      title={t('screens.sections.vault')}
      where={t('screens.vault.where')}
      to={vaultPath()}
      open={t('screens.vault.open')}
    >
      <p className="text-sm text-text-2">{t('screens.vault.intro')}</p>

      <dl className="mt-3.5 divide-y divide-hairline text-sm">
        {VAULT_TOOLS.map((tool) => (
          <div key={tool} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <dt className="basis-24 font-medium">
              <Go to={vaultPath({ tool })}>{t(`screens.vault.rows.${tool}.name`)}</Go>
            </dt>
            <dd className="min-w-0 flex-1 basis-64 text-text-2">
              <Trans
                t={t}
                i18nKey={`screens.vault.rows.${tool}.body`}
                components={{ strong: STRONG }}
              />
            </dd>
          </div>
        ))}
      </dl>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.notObvious')}</h3>
      <Items base="screens.vault.items" items={['filter', 'search', 'redirect']} />

      <NotConnected title={t('screens.vault.notConnectedTitle')}>
        {t('screens.vault.notConnected')}
      </NotConnected>

      <Address i18nKey="screens.vault.address" components={{ code: CODE }} />
    </Screen>
  )
}

/* -------------------------------- scout ----------------------------------- */

export function ScoutScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.scout}
      title={t('screens.sections.scout')}
      where={t('screens.scout.where')}
      to={scoutPath()}
      open={t('screens.scout.open')}
    >
      <p className="text-sm text-text-2">{t('screens.scout.intro')}</p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.whatIsReal')}</h3>
      <Items base="screens.scout.items" items={['pipelines', 'save', 'add']} />

      <NotConnected title={t('screens.scout.notConnectedTitle')}>
        <Trans t={t} i18nKey="screens.scout.notConnected" components={{ strong: STRONG }} />
      </NotConnected>

      <Address i18nKey="screens.scout.address" components={{ code: CODE }} />
    </Screen>
  )
}

/* ------------------------------ statistics -------------------------------- */

export function StatisticsScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.statistics}
      title={t('screens.sections.statistics')}
      where={t('screens.statistics.where')}
      to={statisticsPath()}
      open={t('screens.statistics.open')}
    >
      <p className="text-sm text-text-2">{t('screens.statistics.intro')}</p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.notObvious')}</h3>
      <Items base="screens.statistics.items" items={['funnel', 'typical', 'legend', 'holds']} />

      <Address i18nKey="screens.statistics.address" />
    </Screen>
  )
}
