import { Link, useParams } from 'react-router'
import { Building2, CalendarClock, UserRound } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { STAGE_LABEL, displayName } from '@/data/seed'
import { shortDate, whenLabel } from '@jojo/service/core/dates'
import { useApplications } from '@jojo/service/react/use-applications'
import { useKg } from '@jojo/service/react/kg-context'
import { useOrganisations } from '@jojo/service/react/use-organisations'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { appPath, useTitle, vaultPath } from '@/lib/links'

/**
 * Everything about one employer.
 *
 * The `organisation` node has been in the graph since the graph existed — every
 * application carries an `AT` edge to one — and no screen ever showed it. The
 * seeded data has three universities with two roles each, so "the Rice jobs"
 * was a thing the store knew and a person could not look at: they saw two rows
 * a hundred pixels apart in a list of twelve, with nothing saying they were the
 * same department, the same committee and, in one case, the same week.
 *
 * NOTHING NEW IS STORED. Every panel here is a different traversal of edges that
 * already existed — the applications through `AT`, their dates through `ABOUT`,
 * the people through `FILED_UNDER`. That is the whole reason it is a page and
 * not a feature: the data was there, the address was not.
 *
 * READ-ONLY, and see `useOrganisations` for why. An employer has a name and a
 * slug, both minted by the application that first named it, and renaming one is
 * a different job with its own undo story.
 */
export function Organisation() {
  const { key = '' } = useParams()
  const { get } = useOrganisations()
  const { byId } = useApplications()
  const { forApplication: itemsFor } = useTimeline()
  const { forApplication: filedFor } = useVault()
  const { today } = useKg()

  const organisation = get(key)
  useTitle(organisation ? organisation.name : 'Employer')

  if (!organisation) {
    return (
      <>
        <PageHeader title="Employer" subtitle="Nothing here answers to that address" />
        <Panel>
          <EmptyState
            icon={Building2}
            title="No employer at this address"
            description="An employer page exists for as long as an application names it. If every application to this one was deleted, so was this."
            action={
              <Link to="/applications" className="text-accent underline underline-offset-2">
                Back to applications
              </Link>
            }
          />
        </Panel>
      </>
    )
  }

  const applications = organisation.applicationIds
    .map((id) => byId.get(id))
    .filter((a) => a !== undefined)

  /*
   * Dates and people, gathered across every application here.
   *
   * De-duplicated by id, because both relations are many-to-many: one reminder
   * can be about two of these jobs and one referee is usually named on all of
   * them. Listing either twice would make the page look like it had double the
   * work in it.
   */
  const dates = [
    ...new Map(applications.flatMap((a) => itemsFor(a.id)).map((i) => [i.id, i])).values(),
  ].sort((a, b) => a.date.localeCompare(b.date))

  const people = [
    ...new Map(applications.flatMap((a) => filedFor(a.id).people).map((p) => [p.id, p])).values(),
  ]

  const open = applications.filter((a) => a.stage !== 'closed').length

  return (
    <>
      <PageHeader
        title={organisation.name}
        subtitle={
          applications.length === 1
            ? 'One application here'
            : `${applications.length} applications here, ${open} still open`
        }
      />

      <Panel>
        <PanelTitle>Applications</PanelTitle>
        <RowList>
          {applications.map((a) => (
            <Row key={a.id}>
              <div className="min-w-0 flex-1">
                <Link
                  to={appPath(a)}
                  className="text-sm text-text-1 underline-offset-2 hover:text-accent hover:underline"
                >
                  {a.role || displayName(a)}
                </Link>
                {a.note ? <div className="mt-0.5 text-xs text-text-3">{a.note}</div> : null}
              </div>
              <Chip stage={a.stage}>{STAGE_LABEL[a.stage]}</Chip>
              <Chip tone="gray">{a.roleTag}</Chip>
            </Row>
          ))}
        </RowList>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <PanelTitle hint={dates.length > 0 ? `${dates.length} across these jobs` : undefined}>
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
              Dates
            </span>
          </PanelTitle>
          {dates.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title="Nothing dated here"
              description="Deadlines, interviews and reminders about any of these jobs collect on this page."
            />
          ) : (
            <RowList>
              {dates.map((item) => (
                <Row key={item.id}>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-text-1">{item.title}</div>
                    {item.detail ? (
                      <div className="mt-0.5 text-xs text-text-3">{item.detail}</div>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tabular font-mono text-xs text-text-2">
                      {shortDate(item.date)}
                    </div>
                    <div className="text-xs text-text-3">{whenLabel(item, today)}</div>
                  </div>
                </Row>
              ))}
            </RowList>
          )}
        </Panel>

        <Panel>
          <PanelTitle hint={people.length > 0 ? `${people.length} named` : undefined}>
            <span className="inline-flex items-center gap-2">
              <UserRound className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
              People
            </span>
          </PanelTitle>
          {people.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title="Nobody named yet"
              description="Referees, search chairs and recruiters named on any of these jobs show up here."
              action={
                <Link
                  to={vaultPath({ tool: 'people' })}
                  className="text-accent underline underline-offset-2"
                >
                  Add someone
                </Link>
              }
            />
          ) : (
            <RowList>
              {people.map((p) => (
                <Row key={p.id}>
                  <div className="min-w-0 flex-1">
                    <Link
                      to={vaultPath({ tool: 'people', focus: p.id })}
                      className="text-sm text-text-1 underline-offset-2 hover:text-accent hover:underline"
                    >
                      {p.name}
                    </Link>
                    {p.role ? <div className="mt-0.5 text-xs text-text-3">{p.role}</div> : null}
                  </div>
                  {p.email ? (
                    <a
                      href={`mailto:${p.email}`}
                      className="shrink-0 font-mono text-xs text-text-2 underline-offset-2 hover:text-accent hover:underline"
                    >
                      {p.email}
                    </a>
                  ) : null}
                </Row>
              ))}
            </RowList>
          )}
        </Panel>
      </div>
    </>
  )
}
