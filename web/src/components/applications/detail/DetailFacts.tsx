import type { ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Link } from 'react-router'
import { useOrganisations } from '@jojo/service/react/use-organisations'
import { orgPath } from '@/lib/links'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { hostOf } from '@/components/vault/links/url'
import type { Application } from '@/data/seed'
import { shortDate } from '@/data/timeline'

/** The record's flat fields, two columns wide when there is room for two. */
export function DetailFacts({ application: a }: { application: Application }) {
  const { byName } = useOrganisations()
  const employer = byName(a.org)

  const facts: { label: string; value: ReactNode }[] = [
    /*
     * The way in to the employer's own page, and the only one there is.
     *
     * `organisation` has been a node since the graph existed and nothing linked
     * to it, so three roles at one university were three rows in a list of
     * twelve with nothing saying they belonged together. The link is here rather
     * than on the dialog's title because the title is the job — "Rice —
     * Statistics" — and only half of that is the employer.
     */
    {
      label: 'Employer',
      value: employer ? (
        <Link
          to={orgPath(employer.slug)}
          className="text-info underline underline-offset-2"
          title={`Everything filed under ${employer.name}`}
        >
          {employer.name}
          {employer.applicationIds.length > 1
            ? ` · ${String(employer.applicationIds.length)} jobs here`
            : ''}
        </Link>
      ) : (
        a.org
      ),
    },
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
          {hostOf(a.url) ?? a.url}
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
