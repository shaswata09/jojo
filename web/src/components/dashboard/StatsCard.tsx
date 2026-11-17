import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { ApplicationFrequencyBody } from '@/components/dashboard/ApplicationFrequency'
import { HeadlineRatesBody } from '@/components/dashboard/HeadlineRates'
import { PipelineBody } from '@/components/dashboard/PipelineBreakdown'
import { SearchHealthBody } from '@/components/dashboard/SearchHealth'
import { useScopedApplications } from '@/lib/roles-scope'

/**
 * Four statistics in one card, switched by the control beside the title.
 *
 * The dashboard had room for exactly one of these and Statistics had all four,
 * which meant the answer to "how is the search actually going" lived on a page
 * you had to go looking for. A switch costs one row of chrome and puts all four
 * where the day starts.
 *
 * Each view is the SAME component the Statistics page renders — the bodies were
 * split out of their own panels rather than copied, so a change to how a reply
 * rate is drawn happens once. `check-no-copies` has a whole file arguing why
 * that matters, and this is a case where copying four blocks of markup would
 * have been the quicker thing to do.
 *
 * ## Why the state is not in the URL
 *
 * The vault's tool tabs and the applications board's filters both persist
 * through the query string, because they change what a link points at: sending
 * someone `/vault?tool=files` is the point. This changes which of four readings
 * of the same records is on screen and nothing else, and a dashboard URL that
 * grows a `?stat=` after an idle click is a URL that no longer means "the
 * dashboard".
 */

type ViewKey = 'pipeline' | 'rates' | 'when' | 'next'

/** The views, labelled where they are rendered — `statsCard.views.*` in the reader's language. */
const VIEWS = [
  { value: 'pipeline' as const },
  { value: 'rates' as const },
  { value: 'when' as const },
  { value: 'next' as const },
]

/** Short in the control, full above it — the switch has ~50px per option. Catalog keys. */
const TITLE: Record<ViewKey, string> = {
  pipeline: 'statsCard.titles.pipeline',
  rates: 'statsCard.titles.rates',
  when: 'statsCard.titles.when',
  next: 'statsCard.titles.next',
}

export function StatsCard() {
  const { t } = useTranslation('dashboard')
  const views = VIEWS.map((v) => ({ ...v, label: t(`statsCard.views.${v.value}`) }))
  const [view, setView] = useState<ViewKey>('pipeline')
  // The roles picked in the top bar, so "12 tracked" counts the same records
  // the pie under it draws.
  const { all } = useScopedApplications()

  return (
    <Panel className="@container flex min-w-0 flex-col">
      {/* The switch is anchored, and the title is what gives way.
          `flex-wrap` put the control on a second line as soon as the title grew
          — "Pipeline" is eight characters and "What to work on next" is twenty —
          so the one control on this card moved every time it was used, which is
          the worst thing a control can do. No wrap, the heading takes `min-w-0`
          and truncates, and the switch keeps its place in the corner whatever is
          being shown.

          Except in a narrow CARD, where the switch alone is wider than the
          room: from 1024 to ~1150px the card has 240–300px and the switch takes
          255 (English) to 308 (German), so it hung off the card and, in German,
          scrolled the whole page sideways. Below `@sm` (24rem of card) it has
          its own row, full width, options sharing it — decided by the card's
          width, never by the title, so it still does not move when used. */}
      <div className="mb-4 flex flex-col items-stretch gap-2 @sm:flex-row @sm:items-center @sm:justify-between @sm:gap-3">
        {/* The count stays on Pipeline only. On the other three it would be
            answering a question the view is not asking — "12 tracked" above a
            reply rate reads as the denominator, and it is not. */}
        <PanelTitle
          className="mb-0 min-w-0 truncate"
          hint={view === 'pipeline' ? t('statsCard.tracked', { count: all.length }) : undefined}
        >
          {t(TITLE[view])}
        </PanelTitle>
        <Segment
          className="shrink-0 @max-sm:[&>button]:min-w-0 @max-sm:[&>button]:flex-auto @max-sm:[&>button]:px-1.5 @max-sm:[&>button]:wrap-anywhere @max-sm:[&>button]:hyphens-auto"
          label={t('statsCard.control')}
          options={views}
          value={view}
          onChange={setView}
        />
      </div>

      {/* Bounded, because the four views are not the same height and this card
          sits in a row that stretches to it. Measured at ~460px wide: Pipeline
          274px, Rates 315px, When 335px — and "What to work on next" 911px, a
          radar with six ranked suggestions under it. Unbounded, clicking that
          option nearly quadrupled the card and dragged the whole row with it.

          The negative margins and the padding put straight back inside are
          `OwedThisWeek`'s trick: the rows keep their inset and only the
          scrollbar moves to the panel's edge. */}
      <div className="-mx-4 -mb-4 max-h-[30rem] overflow-x-hidden overflow-y-auto px-4 pb-4 sm:-mx-5 sm:-mb-5 sm:px-5 sm:pb-5">
        {view === 'pipeline' ? <PipelineBody /> : null}
        {view === 'rates' ? <HeadlineRatesBody /> : null}
        {view === 'when' ? <ApplicationFrequencyBody /> : null}
        {view === 'next' ? <SearchHealthBody /> : null}
      </div>
    </Panel>
  )
}
