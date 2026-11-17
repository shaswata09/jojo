import { Link } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Scale } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { annualised, comparable, parseComp } from '@jojo/service/core/comp'
import type { ParsedComp } from '@jojo/service/core/comp'
import { offerDaysLeft } from '@jojo/service/core/dates'
import { displayName } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { useKg } from '@jojo/service/react/kg-context'
import { appPath } from '@/lib/links'
import { useDomain } from '@/i18n/domain'

/**
 * Two offers, side by side, on the one screen where a decision gets made.
 *
 * WHY IT APPEARS ONLY WITH TWO. One offer needs no comparison and already has a
 * card three inches up this page; a permanent panel that spent a whole search
 * saying "nothing to compare" would be furniture. Two is rare, brief and the
 * highest-stakes moment in the whole product — the panel exists for exactly that
 * fortnight and is invisible either side of it.
 *
 * WHY THE MONEY IS PARSED RATHER THAN ASKED FOR. `comp` is free text and always
 * has been, so a numeric field would only help offers entered after it shipped —
 * and would ask a person to type the same number twice at the least patient
 * moment of their year. `core/comp.ts` reads the text instead, and this shows
 * WHAT it read beside the figure, so a wrong parse is caught by the person who
 * knows rather than silently ranking a job.
 *
 * WHAT IT REFUSES TO DO is convert currencies. There is no rate in this app and
 * there should not be one — it needs a network call and a date, and a
 * comparison quietly using last Tuesday's is worse than one that says it cannot
 * compare. Mixed currencies still list, and simply are not ranked.
 */
export function OfferComparison() {
  const { t, i18n } = useTranslation('dashboard')
  const domain = useDomain()
  const { offers } = useApplications()
  const { today } = useKg()

  if (offers.length < 2) return null

  const rows = offers.map((a) => ({
    application: a,
    parsed: a.offer.comp ? parseComp(a.offer.comp) : undefined,
    daysLeft: offerDaysLeft(a.offer, today),
  }))

  /*
   * The best figure, but only when every offer that HAS one can be compared.
   * A mixed-currency set leaves `best` undefined and nothing is marked — which
   * is the honest outcome, not a degraded one.
   */
  const parsed = rows.map((r) => r.parsed).filter((p): p is ParsedComp => p !== undefined)
  const rankable = parsed.length > 1 && parsed.every((p) => comparable(p, parsed[0] as ParsedComp))
  const best = rankable ? Math.max(...parsed.map(annualised)) : undefined

  const anyAssumed = parsed.some((p) => !p.periodStated && p.period !== 'year')
  const anyDerived = parsed.some((p) => p.periodStated && p.period !== 'year')

  return (
    <Panel>
      <PanelTitle hint={t('offers.open', { count: offers.length })}>
        <span className="inline-flex items-center gap-2">
          <Scale className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
          {t('offers.title')}
        </span>
      </PanelTitle>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-sm">
          {/* The panel's heading is outside the table, so a screen reader
              reaching the table by its own list of tables arrives at four
              column names and no subject. Same treatment as the guide's
              directory table, which is the pattern here. */}
          <caption className="sr-only">{t('offers.caption')}</caption>
          <thead>
            <tr className="text-xs text-text-3">
              <th scope="col" className="py-2 pe-3 text-start font-normal">
                {t('offers.columns.job')}
              </th>
              <th scope="col" className="py-2 pe-3 text-start font-normal">
                {t('offers.columns.package')}
              </th>
              <th scope="col" className="py-2 pe-3 text-end font-normal">
                {t('offers.columns.year')}
              </th>
              <th scope="col" className="py-2 text-end font-normal">
                {t('offers.columns.respondBy')}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ application, parsed: p, daysLeft }) => {
              const yearly = p ? annualised(p) : undefined
              return (
                <tr key={application.id} className="border-t border-hairline align-top">
                  {/* A row HEADER, not a cell — every other data table in the
                      app does this and this one was the exception. Without it a
                      screen reader reading down the money column announces
                      "A year, 180,000" with no idea whose offer that is, which
                      on the one screen where two packages are being weighed
                      against each other is the whole content of the row. */}
                  <th scope="row" className="py-2.5 pe-3 text-start font-normal">
                    <Link
                      to={appPath(application)}
                      className="text-text-1 underline-offset-2 hover:text-accent hover:underline"
                    >
                      {displayName(application)}
                    </Link>
                    {application.location ? (
                      <div className="mt-0.5 text-xs text-text-3">{application.location}</div>
                    ) : null}
                  </th>

                  {/* The user's own words, always. The figure beside them is a
                      reading of this, never a replacement for it. */}
                  <td className="py-2.5 pe-3 text-text-2">
                    {application.offer.comp || (
                      <span className="text-text-3">{t('offers.notStated')}</span>
                    )}
                  </td>

                  <td className="tabular py-2.5 pe-3 text-end font-mono">
                    {yearly === undefined ? (
                      <span className="text-text-3" title={t('offers.noAmount')}>
                        {/* The dash is a typographic stand-in and announces as
                            one; `title` is the sighted hover and reaches
                            neither a screen reader nor a keyboard. The reason
                            the cell is empty is the information. */}
                        <span aria-hidden>—</span>
                        <span className="sr-only">{t('offers.noAmount')}</span>
                      </span>
                    ) : (
                      <span
                        className={
                          best !== undefined && yearly === best ? 'text-success' : 'text-text-1'
                        }
                        title={t('offers.readFrom', { text: p?.matched ?? '' })}
                      >
                        {yearly.toLocaleString(i18n.language)}
                        {/* The green was the ONLY thing saying which offer is
                            the bigger one — colour alone, on the row that
                            carries the decision. Said out loud here as well,
                            for a screen reader and for the ~8% of men who
                            cannot take a green as a signal. */}
                        {best !== undefined && yearly === best ? (
                          <span className="sr-only"> {t('offers.highest')}</span>
                        ) : null}
                        {p && p.period !== 'year' ? (
                          <>
                            <span className="text-text-3" aria-hidden>
                              *
                            </span>
                            <span className="sr-only"> {t('offers.annualised')}</span>
                          </>
                        ) : null}
                      </span>
                    )}
                  </td>

                  <td className="py-2.5 text-end">
                    <div className="tabular font-mono text-text-2">
                      {domain.shortDate(application.offer.respondBy)}
                    </div>
                    <div className="mt-0.5">
                      <Chip tone={daysLeft <= 3 ? 'red' : daysLeft <= 7 ? 'amber' : 'gray'}>
                        {daysLeft < 0
                          ? t('offers.passed')
                          : daysLeft === 0
                            ? t('offers.today')
                            : t('offers.daysLeft', { count: daysLeft })}
                      </Chip>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2.5 text-xs text-text-3">
        {rankable ? t('offers.ranked') : t('offers.unranked')}
        {anyDerived || anyAssumed ? ` ${t('offers.annualisedNote')}` : ''}
      </p>
    </Panel>
  )
}
