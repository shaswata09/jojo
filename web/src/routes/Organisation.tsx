import { Link, useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Building2, CalendarClock, UserRound } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { PageHeader } from '@/components/common/PageHeader'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { displayName } from '@/data/seed'
import { useApplications } from '@jojo/service/react/use-applications'
import { useKg } from '@jojo/service/react/kg-context'
import { useOrganisations } from '@jojo/service/react/use-organisations'
import { useTimeline } from '@jojo/service/react/use-timeline'
import { useVault } from '@jojo/service/react/use-vault'
import { appPath, useTitle, vaultPath } from '@/lib/links'
import { useDomain } from '@/i18n/domain'

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
  const { t } = useTranslation('pages')
  const domain = useDomain()
  const { get } = useOrganisations()
  const { byId } = useApplications()
  const { forApplication: itemsFor } = useTimeline()
  const { forApplication: filedFor } = useVault()
  const { today } = useKg()

  const organisation = get(key)
  useTitle(organisation ? organisation.name : t('organisation.fallbackTitle'))

  if (!organisation) {
    return (
      <>
        <PageHeader
          title={t('organisation.fallbackTitle')}
          subtitle={t('organisation.missingSubtitle')}
        />
        <Panel>
          <EmptyState
            icon={Building2}
            title={t('organisation.missingTitle')}
            description={t('organisation.missingDescription')}
            action={
              <Link to="/applications" className="text-accent underline underline-offset-2">
                {t('organisation.backToApplications')}
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
            ? t('organisation.subtitleOne')
            : t('organisation.subtitleMany', { count: applications.length, open })
        }
      />

      <Panel>
        <PanelTitle>{t('organisation.applications')}</PanelTitle>
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
              <Chip stage={a.stage}>{domain.stage(a.stage)}</Chip>
              <Chip tone="gray">{a.roleTag}</Chip>
            </Row>
          ))}
        </RowList>
      </Panel>

      <div className="grid gap-3 md:grid-cols-2">
        <Panel>
          <PanelTitle
            hint={
              dates.length > 0 ? t('organisation.datesHint', { count: dates.length }) : undefined
            }
          >
            <span className="inline-flex items-center gap-2">
              <CalendarClock className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
              {t('organisation.dates')}
            </span>
          </PanelTitle>
          {dates.length === 0 ? (
            <EmptyState
              icon={CalendarClock}
              title={t('organisation.datesEmptyTitle')}
              description={t('organisation.datesEmptyDescription')}
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
                  <div className="shrink-0 text-end">
                    <div className="tabular font-mono text-xs text-text-2">
                      {domain.shortDate(item.date)}
                    </div>
                    <div className="text-xs text-text-3">{domain.when(item, today)}</div>
                  </div>
                </Row>
              ))}
            </RowList>
          )}
        </Panel>

        <Panel>
          <PanelTitle
            hint={
              people.length > 0 ? t('organisation.peopleHint', { count: people.length }) : undefined
            }
          >
            <span className="inline-flex items-center gap-2">
              <UserRound className="size-4 text-accent" strokeWidth={1.8} aria-hidden />
              {t('organisation.people')}
            </span>
          </PanelTitle>
          {people.length === 0 ? (
            <EmptyState
              icon={UserRound}
              title={t('organisation.peopleEmptyTitle')}
              description={t('organisation.peopleEmptyDescription')}
              action={
                <Link
                  to={vaultPath({ tool: 'people' })}
                  className="text-accent underline underline-offset-2"
                >
                  {t('organisation.addSomeone')}
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
