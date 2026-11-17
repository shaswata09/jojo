import { intlLocale } from '@jojo/service/core/intl-locale'
import { useTranslation } from 'react-i18next'
import { AddByUrl } from '@/components/applications/AddByUrl'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel } from '@/components/common/Panel'
import { GlancePanel } from '@/components/dashboard/GlancePanel'
import { OwedThisWeek } from '@/components/dashboard/OwedThisWeek'
import { StatsCard } from '@/components/dashboard/StatsCard'
import { PriorityActions } from '@/components/dashboard/PriorityActions'
import { OfferComparison } from '@/components/dashboard/OfferComparison'
import { RecentApplications } from '@/components/dashboard/RecentApplications'
import { useApplications } from '@jojo/service/react/use-applications'
import { useTitle } from '@/lib/links'
import { TODAY_PARTS } from '@/lib/today'
import { domain } from '@/i18n/domain'

/**
 * "Monday 12 October" — today, spelled out.
 *
 * Built here rather than imported because nothing else in the app spells a date
 * out in full — every other surface uses `shortDate`. Naming the weekday is the
 * point of the header: this is the only screen whose subject is the day itself.
 *
 * A FUNCTION of the parts rather than a module-level const, and it was a const
 * until this was measured. `TODAY_PARTS` is a live binding — `@/lib/today`
 * re-pins it at the local midnight — so a const derived from it was fixed at
 * the moment this module was first imported. On fake timers from 23:50 on
 * 12 Oct, twenty minutes advanced, the pin read 2026-10-13 and this label still
 * read "Monday 12 October". That is the worst place in the app for it: the page
 * is titled Today and the subtitle is the only sentence on it that names a day.
 */
const spellOut = (parts: { year: number; month: number; day: number }, language: string) =>
  language === 'en'
    ? `${domain.weekday(new Date(parts.year, parts.month - 1, parts.day).getDay())} ${parts.day} ${domain.month(parts.month)}`
    : // Every other language spells the day its own way — order, case and
      // punctuation included — which is what `Intl` is for.
      new Intl.DateTimeFormat(intlLocale(language), {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date(parts.year, parts.month - 1, parts.day))

/**
 * The landing screen, and until now the only route with no `PageHeader` — no
 * title, no day, and nowhere that said the thing the whole product is built
 * around: that none of this leaves the machine. That promise was stated on the
 * guide, the settings page and the profile, which is three pages a new user has
 * no reason to open before deciding whether to trust the app with a job search.
 *
 * The two charts that used to sit in the second row are gone. Both render
 * identically on /statistics, and both were pushing the week's actual work —
 * what is overdue, what is due — below the fold on a 900px screen.
 */
export function Dashboard() {
  const { t, i18n } = useTranslation('pages')
  useTitle(t('dashboard.title'))
  const { all } = useApplications()

  // Spelled at render, so the header follows the pin the rest of the app moved
  // to at midnight.
  const todayLabel = spellOut(TODAY_PARTS, i18n.language)

  const subtitle =
    all.length === 0
      ? t('dashboard.subtitleEmpty', { date: todayLabel })
      : t('dashboard.subtitle', { date: todayLabel, count: all.length })

  return (
    <>
      <PageHeader title={t('dashboard.title')} subtitle={subtitle} />

      {/* The quick start the owner asked for: paste a posting's link and start
          an application from it, above the deck. It is the same AddByUrl as on
          /applications, so the button opens the same flow there and here — the
          From link reader with a model connected, the form without one — and
          the duplicate check at Save comes with it. One row on its own slim
          surface: the field takes the width and the button sits on its right,
          which still fits a 400px phone. */}
      <Panel aria-label={t('dashboard.startFromLink')} className="py-2.5 sm:py-3">
        <AddByUrl />
      </Panel>

      <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
        <PriorityActions />
        {/* Renders nothing below two offers. See the panel's own header. */}
        <OfferComparison />
        <GlancePanel />
      </div>

      {/* The week gets the wider column and the two reference panels stack
          beside it: "Owed this week" is the only thing on this row you act on,
          and it is the one that grows as the search does.

          `items-stretch` rather than `items-start`, so the left panel is exactly
          as tall as Recent applications and Pipeline together. Left to itself
          the row ended level at some record counts and ragged at others, which
          reads as a layout that slipped rather than one that adapts. The list
          inside takes the height it is given and scrolls — see OwedThisWeek. */}
      <div className="grid grid-cols-1 items-stretch gap-4 sm:gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <OwedThisWeek />
        <div className="flex min-w-0 flex-col gap-4 sm:gap-5">
          <RecentApplications />
          <StatsCard />
        </div>
      </div>
    </>
  )
}
