import { Cpu, FileText, HardDrive, MonitorSmartphone, Puzzle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { assistantPath, guidePath, scoutPath, settingsPath } from '@/lib/links'
import { cn } from '@/lib/utils'

/**
 * One rung. `id` names its words in the `guide` catalog —
 * `overview.ladder.layers.<id>.name`, `.requires` and `.gives` — which are
 * translated where the card is drawn rather than frozen here at import time.
 */
type Layer = {
  icon: LucideIcon
  id: string
  active: boolean
}

const LAYERS: Layer[] = [
  { icon: MonitorSmartphone, id: 'browser', active: true },
  { icon: HardDrive, id: 'backup', active: true },
  { icon: Cpu, id: 'model', active: true },
  { icon: FileText, id: 'reader', active: true },
  { icon: Puzzle, id: 'extension', active: true },
]

const KBD = <Kbd>{''}</Kbd>

export function LadderSection() {
  const { t } = useTranslation('guide')
  return (
    <section id="ladder" className="scroll-mt-4">
      <h2 className="mb-3 text-base font-medium">
        {t('overview.ladder.title')}
        <small className="ms-2 font-sans text-xs font-normal text-text-3 [unicode-bidi:isolate]">
          {t('overview.ladder.aside')}
        </small>
      </h2>
      {/* The first two rungs are a tracker; the third is where it starts working
          on the search for you. Worth saying once here, because the cards below
          are a list of capabilities and a list does not have a turning point. */}
      <p className="mb-3 text-sm text-text-2">{t('overview.ladder.intro')}</p>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-3.5 lg:grid-cols-3">
        {LAYERS.map((l) => (
          <li
            key={l.id}
            className={cn('surface rounded-lg p-4', l.active ? 'border-accent-border' : undefined)}
          >
            <div className="flex items-center gap-2">
              <l.icon
                className={cn('size-4', l.active ? 'text-accent' : 'text-text-3')}
                strokeWidth={1.7}
                aria-hidden
              />
              <h3 className="text-sm font-medium">{t(`overview.ladder.layers.${l.id}.name`)}</h3>
              {/* `active` means "this rung is built", not "you have it set up".
                  It read "not connected" on the model rung while the assistant
                  was already agentic against a real endpoint — a page telling
                  the reader a feature does not exist while they are using it.
                  Whether YOU have one configured is answered by the runtime tile
                  in the sidebar, which probes; a static page cannot know. */}
              {l.active ? (
                <span className="ms-auto text-xs text-accent">{t('overview.ladder.built')}</span>
              ) : (
                <span className="ms-auto text-xs text-text-3">{t('overview.ladder.notBuilt')}</span>
              )}
            </div>
            <p className="mt-2 text-xs text-text-3">
              {t(`overview.ladder.layers.${l.id}.requires`)}
            </p>
            <p className="mt-1.5 text-sm text-text-2">
              {t(`overview.ladder.layers.${l.id}.gives`)}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.ladder.outro"
          components={{
            assistant: <Go to={assistantPath()} />,
            scout: <Go to={scoutPath()} />,
            screens: <Go to={guidePath('screens')} />,
          }}
        />
      </p>

      {/* Kept last. This used to be two panels of unbuilt work — a localhost
          bridge and a local model — sitting two thirds of the way up a 370-line
          page, so a first-time reader spent longer on what jojo could not do
          than on what it could. The bridge half is gone: documents are stored
          and backups are real, so the first panel now describes something that
          happens rather than something that would. */}
      <div className="mt-3 grid grid-cols-1 gap-4 sm:mt-3.5 sm:gap-5 lg:grid-cols-2">
        <Panel>
          <PanelTitle hint={t('overview.ladder.backup.hint')}>
            {t('overview.ladder.backup.title')}
          </PanelTitle>
          <ol className="divide-y divide-hairline text-sm">
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{t('overview.ladder.backup.storedTitle')}</p>
              <p className="mt-1 text-text-2">{t('overview.ladder.backup.stored')}</p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{t('overview.ladder.backup.oneFileTitle')}</p>
              <p className="mt-1 text-text-2">
                <Trans
                  t={t}
                  i18nKey="overview.ladder.backup.oneFile"
                  components={{ settings: <Go to={settingsPath()} /> }}
                />
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{t('overview.ladder.backup.whyTitle')}</p>
              <p className="mt-1 text-text-2">
                <Trans t={t} i18nKey="overview.ladder.backup.why" components={{ kbd: KBD }} />
              </p>
            </li>
          </ol>
        </Panel>

        <Panel>
          <PanelTitle hint={t('overview.ladder.model.hint')}>
            {t('overview.ladder.model.title')}
          </PanelTitle>
          <ol className="divide-y divide-hairline text-sm">
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{t('overview.ladder.model.connectTitle')}</p>
              <p className="mt-1 text-text-2">
                <Trans
                  t={t}
                  i18nKey="overview.ladder.model.connect"
                  components={{ settings: <Go to={settingsPath()} /> }}
                />
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{t('overview.ladder.model.changesTitle')}</p>
              <p className="mt-1 text-text-2">
                <Trans
                  t={t}
                  i18nKey="overview.ladder.model.changes"
                  components={{ assistant: <Go to={assistantPath()} /> }}
                />
              </p>
            </li>
            <li className="py-3 first:pt-0 last:pb-0">
              <p className="font-medium">{t('overview.ladder.model.scoringTitle')}</p>
              <p className="mt-1 text-text-2">{t('overview.ladder.model.scoring')}</p>
            </li>
          </ol>
        </Panel>
      </div>
    </section>
  )
}
