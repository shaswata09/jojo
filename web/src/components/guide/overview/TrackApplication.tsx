import { Trans, useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Kbd } from '@/components/guide/Kbd'
import { Go } from '@/components/guide/overview/Go'
import { StageRail } from '@/components/guide/overview/StageRail'
import { STAGE_ASKS } from '@/components/guide/overview/stage-asks'
import { STAGES } from '@/data/seed'
import { applicationsPath, statisticsPath } from '@/lib/links'
import { useDomain } from '@/i18n/domain'

const LEAD = <span className="font-medium text-text-1" />
const KBD = <Kbd>{''}</Kbd>

export function TrackApplicationSection() {
  const { t } = useTranslation('guide')
  const domain = useDomain()
  return (
    <Panel id="application" className="scroll-mt-4">
      <PanelTitle hint={t('overview.track.hint')}>{t('overview.track.title')}</PanelTitle>

      <p className="text-sm text-text-2">
        <Trans
          t={t}
          i18nKey="overview.track.intro"
          components={{
            stats: <Go to={statisticsPath()} />,
            board: <Go to={applicationsPath()} />,
            kbd: KBD,
          }}
        />
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:mt-5 lg:grid-cols-[auto_1fr] lg:gap-6">
        <StageRail />

        <div className="min-w-0">
          <h3 className="text-sm font-medium">{t('overview.track.movesTitle')}</h3>
          {/* Was "Moving a card is a drag on the board, or the stage menu on a
              row or a detail page. Four of the six destinations open a short
              form first" — which reads as true of all three, and only the
              third one is. Drag, the board pill and the table chip share one
              path that never asks (`Applications.tsx` onMoveStage: set the
              stage, toast, offer Undo). `stageNeedsDetails` is called from
              exactly one place, `onMoveStage` in `routes/ApplicationDetail.tsx`.
              Someone who
              dragged a card to Offer and waited for the form to appear would
              have been told to expect it here. */}
          <p className="mt-1 text-sm text-text-2">{t('overview.track.movesIntro')}</p>
          <dl className="mt-3 divide-y divide-hairline text-sm">
            {STAGES.map((stage) => (
              <div key={stage.id} className="flex flex-wrap gap-x-3 gap-y-1 py-2.5">
                <dt className="flex basis-32 items-baseline gap-2 font-medium">
                  <span
                    aria-hidden
                    className="size-2 shrink-0 translate-y-px rounded-full"
                    style={{ background: `var(--stage-${stage.id})` }}
                  />
                  {domain.stage(stage.id)}
                </dt>
                <dd className="min-w-0 flex-1 basis-64 text-text-2">
                  {STAGE_ASKS[stage.id] === ''
                    ? t('overview.track.asksNothing')
                    : t(STAGE_ASKS[stage.id])}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-text-2">{t('overview.track.offerQuestion')}</p>
        </div>
      </div>

      <h3 className="mt-5 text-sm font-medium">{t('overview.track.onceTitle')}</h3>
      <ul className="mt-2 list-disc space-y-1.5 ps-5 text-sm text-text-2 marker:text-text-3">
        <li>{t('overview.track.once.open')}</li>
        <li>{t('overview.track.once.note')}</li>
        <li>
          <Trans t={t} i18nKey="overview.track.once.duplicate" components={{ lead: LEAD }} />
        </li>
        <li>{t('overview.track.once.delete')}</li>
        {/* The offer link was `applicationsPath({ stage: 'offer' })` and read
            "everything at offer" while landing on everything. `?stage=` is
            read by `Applications.tsx`, but only `tableRows` narrows by it and
            only the table renders the stage chips — the board draws `pool`,
            which is filtered by the search and the keyword and role
            selections and never by the stage, because it is already grouped
            into stage columns. Since `view` defaults to `board`, the link
            opened the board and the filter went nowhere: 12 shown of 12,
            under a label promising one. Naming the table is the fix, and the
            sentence above it now says which controls the table owns rather
            than implying the address bar drives both views equally. */}
        <li>
          <Trans
            t={t}
            i18nKey="overview.track.once.address"
            components={{
              bystage: <Go to={applicationsPath({ view: 'table', sort: 'stage' })} />,
              atoffer: <Go to={applicationsPath({ view: 'table', stage: 'offer' })} />,
            }}
          />
        </li>
      </ul>
    </Panel>
  )
}
