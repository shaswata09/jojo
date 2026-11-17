import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { CircleCheck, Lightbulb, Ruler } from 'lucide-react'
import { Panel } from '@/components/common/Panel'
import { recommendationsFor } from '@jojo/service/core/recommend'
import type { Recommendation } from '@jojo/service/core/recommend'
import { useScopedApplications } from '@/lib/roles-scope'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useGraph, useKg } from '@jojo/service/react/kg-context'
import { TODAY } from '@/lib/today'
import { useAdvice } from '@/i18n/advice'

/**
 * What to do next, ranked, with the counts behind each line.
 *
 * The rest of this page reports; this decides. Everything it says comes from
 * `core/recommend.ts`, which is arithmetic — no model writes a word of it, for
 * the reason `assess.ts` gives at length: a paragraph of advice about somebody's
 * job search is exactly what a language model produces fluently and
 * unaccountably, and the reader has no way to check it.
 *
 * ## The two badges are the honest part
 *
 * `Measured` means counted from this person's own records. `Suggested` means
 * general, or measured against the typical search — a benchmark this app chose
 * as a round comparison, which `TYPICAL`'s own header admits. Rendering the two
 * identically is what would make this page start sounding like it knows things
 * it does not, and it is the failure the whole Statistics rebuild was about.
 *
 * ## Why it sits at the top
 *
 * Somebody opening Statistics on a Sunday evening is asking "what should I do",
 * and the funnel answers "here is how it is going". Both are worth having, and
 * only one of them is a question.
 */

/** Catalog keys, translated where the badge is drawn. */
const BADGE: Record<Recommendation['strength'], { label: string; hint: string }> = {
  measured: { label: 'nextSteps.badges.measured.label', hint: 'nextSteps.badges.measured.hint' },
  suggested: {
    label: 'nextSteps.badges.suggested.label',
    hint: 'nextSteps.badges.suggested.hint',
  },
}

export function NextSteps() {
  const { t } = useTranslation('statistics')
  const advice = useAdvice()
  // The roles picked in the top bar, like every other figure on this page.
  const { all } = useScopedApplications()
  const { all: timeline } = useTimeline()
  const graph = useGraph()
  const { projections } = useKg()

  const background = projections.background(graph).length

  const items = useMemo(
    () => recommendationsFor({ applications: all, timeline, background, today: TODAY }),
    [all, timeline, background],
  )

  // Nothing at all means an empty search — not a search in good order, which
  // `recommendationsFor` reports as its own item. A panel saying "you are doing
  // fine" to somebody who has added no applications is the fabricated-search
  // failure this page was rebuilt to remove.
  if (items.length === 0) return null

  return (
    <Panel aria-labelledby="next-steps" focusId="stats-next-steps">
      <h2 id="next-steps" className="mb-1 text-base font-medium">
        {t('nextSteps.title')}
      </h2>
      <p className="mb-3.5 text-xs text-text-3">{t('nextSteps.intro')}</p>

      <ol className="flex flex-col gap-3.5">
        {items.map((item) => {
          const clear = item.id === 'clear'
          const badge = BADGE[item.strength]
          const Icon = clear ? CircleCheck : item.strength === 'measured' ? Ruler : Lightbulb
          // Core writes the English for the agent; the screen says it again,
          // from the same figures, in the language on screen.
          const said = advice.recommendation(item)
          return (
            <li key={item.id} className="flex gap-2.5">
              <Icon
                aria-hidden
                className={`mt-0.5 size-4 shrink-0 ${clear ? 'text-success' : 'text-text-3'}`}
              />
              <div className="min-w-0">
                <p className="text-sm font-medium">
                  {said.headline}
                  {!clear && (
                    <span
                      title={t(badge.hint)}
                      className="ms-2 rounded border border-hairline px-1.5 py-0.5 align-middle text-[11px] font-normal text-text-3"
                    >
                      {t(badge.label)}
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-sm text-text-2">{said.because}</p>
              </div>
            </li>
          )
        })}
      </ol>
    </Panel>
  )
}
