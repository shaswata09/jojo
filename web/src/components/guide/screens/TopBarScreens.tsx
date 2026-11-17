/**
 * The four sections for the four icons at the right of the top bar, in the
 * order the icons sit in.
 *
 * None of these four has a row in the sidebar, which is the whole reason this
 * page exists — so they are filed under the door they do have.
 */

import type { ReactElement } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { GuideContents } from '@/components/guide/GuideNav'
import { Kbd } from '@/components/guide/Kbd'
import { Address, Code, Go, NotConnected, Screen } from '@/components/guide/screens/ScreenParts'
import { S } from '@/components/guide/screens/sections'
import { assistantPath, guidePath, profilePath, settingsPath, vaultPath } from '@/lib/links'

const STRONG = <span className="text-text-1" />
const CODE = <Code />

/** The backup's file name shape. A name, not words: the same in every language. */
const BACKUP_FILE = 'jojo-backup-YYYY-MM-DD.json'

/** A bulleted list of catalog sentences that may carry `<strong>` and links. */
function Items({
  base,
  items,
  links,
  top = 'mt-2',
}: {
  base: string
  items: readonly string[]
  links?: Record<string, ReactElement>
  /** The list's top margin; it follows a heading everywhere but once. */
  top?: string
}) {
  const { t } = useTranslation('guide')
  return (
    <ul className={`${top} list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3`}>
      {items.map((item) => (
        <li key={item}>
          <Trans
            t={t}
            i18nKey={`${base}.${item}`}
            values={{ file: BACKUP_FILE }}
            components={{ strong: STRONG, ...links }}
          />
        </li>
      ))}
    </ul>
  )
}

/* ------------------------------- profile ---------------------------------- */

export function ProfileScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.profile}
      title={t('screens.sections.profile')}
      where={t('screens.profile.where')}
      to={profilePath()}
      open={t('screens.profile.open')}
    >
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="screens.profile.intro"
          components={{ overview: <Go to={guidePath('overview')} /> }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.notObvious')}</h3>
      <Items
        base="screens.profile.items"
        items={['match', 'documents', 'save', 'example']}
        links={{ vault: <Go to={vaultPath({ tool: 'files' })} /> }}
      />

      <Address i18nKey="screens.parts.addressNothing" />
    </Screen>
  )
}

/* ------------------------------ assistant --------------------------------- */

export function AssistantScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.assistant}
      title={t('screens.sections.assistant')}
      where={t('screens.assistant.where')}
      to={assistantPath()}
      open={t('screens.assistant.open')}
    >
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="screens.assistant.intro"
          components={{ settings: <Go to={settingsPath()} /> }}
        />
      </p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.assistant.connectedTitle')}</h3>
      <Items base="screens.assistant.connected" items={['agentic', 'threads', 'documents']} />

      <NotConnected title={t('screens.assistant.notConnectedTitle')}>
        <Trans t={t} i18nKey="screens.assistant.notConnected" components={{ strong: STRONG }} />
      </NotConnected>

      <Items
        base="screens.assistant.items"
        items={['save', 'copy', 'delete']}
        links={{ vault: <Go to={vaultPath({ tool: 'snippets' })} /> }}
        top="mt-3.5"
      />

      <Address i18nKey="screens.parts.addressNothing" />
    </Screen>
  )
}

/* ------------------------------- settings --------------------------------- */

export function SettingsScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.settings}
      title={t('screens.sections.settings')}
      where={t('screens.settings.where')}
      to={settingsPath()}
      open={t('screens.settings.open')}
    >
      <p className="text-sm text-text-2">{t('screens.settings.intro')}</p>

      <h3 className="mt-4 text-sm font-medium">{t('screens.parts.whatIsReal')}</h3>
      <Items
        base="screens.settings.items"
        items={['export', 'clear', 'keywords', 'diagnostics', 'audit']}
      />

      <NotConnected title={t('screens.settings.notConnectedTitle')}>
        <Trans
          t={t}
          i18nKey="screens.settings.notConnected"
          components={{ strong: STRONG, overview: <Go to={guidePath('overview')} /> }}
        />
      </NotConnected>

      <Address i18nKey="screens.parts.addressNothing" />
    </Screen>
  )
}

/* -------------------------------- guide ----------------------------------- */

export function GuideScreen() {
  const { t } = useTranslation('guide')
  return (
    <Screen
      id={S.guide}
      title={t('screens.sections.guide')}
      where={t('screens.guide.where')}
      to={guidePath()}
      open={t('screens.guide.open')}
    >
      <p className="text-sm text-text-2">
        <Trans t={t} i18nKey="screens.guide.intro" components={{ kbd: <Kbd>{''}</Kbd> }} />
      </p>
      <p className="mt-2 text-sm text-text-2">{t('screens.guide.order')}</p>

      <div className="mt-4">
        <GuideContents />
      </div>

      <Address i18nKey="screens.guide.address" components={{ code: CODE }} />
    </Screen>
  )
}
