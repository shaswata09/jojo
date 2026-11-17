/**
 * The three sections about working across records rather than inside one: the
 * keyboard, keywords, and asking the store a question.
 *
 * Each is about reaching something you did not navigate to — a palette that
 * finds any record, a tag that cuts across every kind of them, and a query that
 * answers what no list can. The undo story lives with the keyboard because
 * ⌘Z is where a reader meets it.
 */

import { Trans, useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { applicationsPath, graphPath, guidePath, profilePath, settingsPath } from '@/lib/links'

const STRONG = <span className="text-text-1" />
const LEAD = <span className="font-medium text-text-1" />
const KBD = <Kbd>{''}</Kbd>

/* ----------------------------- keys and undo ------------------------------ */

export function KeysSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="keys" className="scroll-mt-4">
      <PanelTitle hint={t('overview.keys.hint')}>{t('overview.keys.title')}</PanelTitle>

      <dl className="divide-y divide-hairline text-sm">
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-3 first:pt-0">
          <dt className="shrink-0 basis-28">
            <Kbd>⌘K</Kbd> <span className="text-text-3">/</span> <Kbd>Ctrl K</Kbd>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            <Trans t={t} i18nKey="overview.keys.find" components={{ lead: LEAD, strong: STRONG }} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-3">
          <dt className="shrink-0 basis-28">
            <Kbd>n</Kbd>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            <Trans t={t} i18nKey="overview.keys.make" components={{ lead: LEAD }} />
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1.5 py-3 last:pb-0">
          <dt className="shrink-0 basis-28">
            <Kbd>⌘Z</Kbd> <span className="text-text-3">/</span> <Kbd>⇧⌘Z</Kbd>
          </dt>
          <dd className="min-w-0 flex-1 basis-64 text-text-2">
            <Trans t={t} i18nKey="overview.keys.undo" components={{ lead: LEAD }} />
          </dd>
        </div>
      </dl>

      <h3 className="mt-4 text-sm font-medium">{t('overview.keys.twoUndosTitle')}</h3>
      <p className="mt-1 text-sm text-text-2">
        <Trans t={t} i18nKey="overview.keys.twoUndos" components={{ kbd: KBD, strong: STRONG }} />
      </p>
      <p className="mt-2 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.keys.pile"
          components={{ settings: <Go to={settingsPath()} /> }}
        />
      </p>
    </Panel>
  )
}

/* -------------------------------- keywords -------------------------------- */

export function KeywordsSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="keywords" className="scroll-mt-4">
      <PanelTitle hint={t('overview.keywords.hint')}>{t('overview.keywords.title')}</PanelTitle>
      <p className="text-sm text-text-2">{t('overview.keywords.intro')}</p>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:gap-3.5 lg:grid-cols-2">
        <div className="surface rounded-lg p-4">
          <h3 className="text-sm font-medium">{t('overview.keywords.yoursTitle')}</h3>
          <p className="mt-1.5 text-sm text-text-2">{t('overview.keywords.yours')}</p>
          <p className="mt-2 text-sm text-text-2">
            <Trans
              t={t}
              i18nKey="overview.keywords.record"
              components={{ settings: <Go to={settingsPath()} /> }}
            />
          </p>
        </div>
        <div className="surface rounded-lg p-4">
          <h3 className="text-sm font-medium">{t('overview.keywords.rolesTitle')}</h3>
          <p className="mt-1.5 text-sm text-text-2">
            <Trans
              t={t}
              i18nKey="overview.keywords.roles"
              components={{ profile: <Go to={profilePath()} /> }}
            />
          </p>
          <p className="mt-2 text-sm text-text-2">
            <Trans
              t={t}
              i18nKey="overview.keywords.roleFilter"
              components={{ applications: <Go to={applicationsPath()} /> }}
            />
          </p>
        </div>
      </div>
    </Panel>
  )
}

/* --------------------------------- graph ---------------------------------- */

const GRAPH_EXAMPLES = ['noFollowUp', 'keyword', 'twice', 'unlinked', 'unusedFiles'] as const

export function GraphSection() {
  const { t } = useTranslation('guide')
  return (
    <Panel id="graph" className="scroll-mt-4">
      <PanelTitle hint={t('overview.graph.hint')}>{t('overview.graph.title')}</PanelTitle>
      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.graph.intro"
          components={{ graph: <Go to={graphPath()} />, strong: STRONG }}
        />
      </p>
      <p className="mt-2 text-sm text-text-2">
        <Trans t={t} i18nKey="overview.graph.pickers" components={{ strong: STRONG }} />
      </p>
      <h3 className="mt-4 text-sm font-medium">{t('overview.graph.examplesTitle')}</h3>
      <ul className="mt-2 list-disc space-y-1 ps-5 text-sm text-text-2 marker:text-text-3">
        {GRAPH_EXAMPLES.map((example) => (
          <li key={example}>{t(`overview.graph.examples.${example}`)}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm text-text-2">
        <Trans t={t} i18nKey="overview.graph.path" components={{ strong: STRONG }} />
      </p>
      <p className="mt-2 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.graph.illustrative"
          components={{ strong: STRONG, guide: <Go to={guidePath('graph')} /> }}
        />
      </p>
    </Panel>
  )
}
