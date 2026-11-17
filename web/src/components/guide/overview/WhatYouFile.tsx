/**
 * The three sections about what you keep alongside an application: its dates,
 * the Vault shelf, and your own profile.
 *
 * Together because they are the same argument three times — one record type
 * with several names, one shelf with five tools, one profile that is a record
 * like any other — and a reader who has the application section has everything
 * needed to read all three.
 */

import { Trans, useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Go } from '@/components/guide/overview/Go'
import { calendarPath, dashboardPath, profilePath, vaultPath } from '@/lib/links'

const STRONG = <span className="text-text-1" />

/* --------------------------------- dates ---------------------------------- */

export function DatesSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="dates" className="scroll-mt-4">
      <PanelTitle hint={t('overview.dates.hint')}>{t('overview.dates.title')}</PanelTitle>
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.dates.intro"
          components={{ calendar: <Go to={calendarPath()} />, today: <Go to={dashboardPath()} /> }}
        />
      </p>
      <ul className="mt-3 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        <li>{t('overview.dates.items.grid')}</li>
        <li>{t('overview.dates.items.colour')}</li>
        <li>{t('overview.dates.items.url')}</li>
        <li>
          <Trans
            t={t}
            i18nKey="overview.dates.items.reminders"
            components={{ reminders: <Go to={vaultPath({ tool: 'reminders' })} /> }}
          />
        </li>
        <li>{t('overview.dates.items.mint')}</li>
      </ul>
    </Panel>
  )
}

/* --------------------------------- vault ---------------------------------- */

/** The five tools in shelf order; each row's words are `overview.vault.<tool>`. */
const VAULT_TOOLS = ['reminders', 'links', 'files', 'snippets', 'tools'] as const

export function VaultSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="vault" className="scroll-mt-4">
      <PanelTitle hint={t('overview.vault.hint')}>{t('overview.vault.title')}</PanelTitle>
      <dl className="divide-y divide-hairline text-sm">
        {VAULT_TOOLS.map((tool) => (
          <div key={tool} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5 first:pt-0 last:pb-0">
            <dt className="basis-24 font-medium">
              <Go to={vaultPath({ tool })}>{t(`overview.vault.${tool}.name`)}</Go>
            </dt>
            <dd className="min-w-0 flex-1 basis-64 text-text-2">
              <Trans
                t={t}
                i18nKey={`overview.vault.${tool}.body`}
                components={{ strong: STRONG }}
              />
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

/* -------------------------------- profile --------------------------------- */

export function ProfileSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="profile" className="scroll-mt-4">
      <PanelTitle hint={t('overview.profile.hint')}>{t('overview.profile.title')}</PanelTitle>
      {/* This paragraph said the profile was "kept for the visit only rather
          than writing it anywhere, which is why the checklist above cannot
          tick for it". That stopped being true when the profile became a
          record like any other — `Profile.tsx` retracted the same sentence in
          its save toast, and this was the last place in the app still making
          the claim. The real reason it is not a checklist step is duller and
          true: there is one profile whether or not you have filled it in, so
          there is nothing for a count of records you have created to count. */}
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.profile.body"
          components={{ profile: <Go to={profilePath()} /> }}
        />
      </p>
      <p className="mt-2 text-sm text-text-2">{t('overview.profile.documents')}</p>
    </Panel>
  )
}
