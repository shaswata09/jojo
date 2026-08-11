import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Panel, PanelTitle } from '@/components/common/Panel'
import type { Application } from '@/data/seed'
import { shortDate } from '@/data/timeline'

/** The record's flat fields, two columns wide when there is room for two. */
export function DetailFacts({ application: a }: { application: Application }) {
  const facts: { label: string; value: ReactNode }[] = [
    { label: 'Source', value: a.source },
    { label: 'Location', value: a.location },
    // Falls through to the offer. Baylor's record states "$112k + $15k startup"
    // in the offer block and printed "Compensation —" 200px underneath it,
    // because the number was typed into the stage form and `a.comp` was never
    // the field it landed in.
    { label: 'Compensation', value: a.comp ?? a.offer?.comp },
    {
      label: 'Posting',
      value: a.url ? (
        <a
          href={a.url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-info underline underline-offset-2"
        >
          {hostOf(a.url)}
          <ExternalLink className="size-3 shrink-0" strokeWidth={2} aria-hidden />
        </a>
      ) : undefined,
    },
    { label: 'Applied on', value: a.appliedOn ? shortDate(a.appliedOn) : undefined },
    { label: 'Submitted on', value: a.submittedOn ? shortDate(a.submittedOn) : undefined },
  ]

  return (
    <Panel className="min-w-0">
      <PanelTitle>Details</PanelTitle>
      <dl className="grid gap-x-5 gap-y-3 @md:grid-cols-2">
        {facts.map((f) => (
          <div key={f.label} className="min-w-0">
            <dt className="text-xs text-text-3">{f.label}</dt>
            <dd className="mt-0.5 truncate text-sm text-text-1">
              {f.value ?? <span className="text-text-3">—</span>}
            </dd>
          </div>
        ))}
      </dl>
    </Panel>
  )
}

/**
 * 'stripe.com' out of a posting URL, so the link reads as a destination rather
 * than as 180 characters of tracking parameters. A URL the user typed by hand
 * may not parse at all, in which case the raw string is still the honest thing
 * to show.
 */
function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}
