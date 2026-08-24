import type { Ref } from 'react'
import { Radar } from 'lucide-react'
import { Link } from 'react-router'
import { Chip } from '@/components/common/Chip'
import { listJoin } from '@/components/common/text'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { Button } from '@/components/ui/button'
import type { Match } from '@/data/scout'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { appPath } from '@/lib/links'
import type { ScoutFocus } from '@/lib/links'
import { fitOf } from '@jojo/service/core/fit'
import type { Profile } from '@jojo/service/core/model'
import { cn } from '@/lib/utils'

/** Fit bands. A number alone doesn't say whether 64 is good. */
function fitTone(fit: number) {
  if (fit >= 80) return 'green' as const
  if (fit >= 60) return 'amber' as const
  return 'gray' as const
}

export function MatchesPanel({
  matches,
  getApplication,
  focus,
  focusedRow,
  onPromote,
  profile,
}: {
  matches: readonly Match[]
  getApplication: (id: string) => Application | undefined
  focus: ScoutFocus | undefined
  /** Attached to the row a link arrived naming, so it scrolls itself into view. */
  focusedRow: Ref<HTMLDivElement>
  onPromote: (matchId: string) => void
  /** Scored against, rather than decorated with. See the panel title. */
  profile: Profile
}) {
  return (
    <Panel>
      {/*
        The hint has been wrong twice. It read "last run Oct 11" when nothing had
        ever run, and then "example scores" — honest, and describing fixtures the
        phone had already stopped using. The numbers are computed here now, from
        the same `core/fit.ts` the phone scores with, so it says what they are
        measured against.
      */}
      <PanelTitle hint="scored against your profile">Matches</PanelTitle>

      {matches.length === 0 ? (
        <EmptyState
          icon={Radar}
          title="No matches"
          description="Pipelines put scored postings here once a model is connected. Until then, the postings you save below are the way in."
        />
      ) : (
        <RowList>
          {matches.map((m) => {
            // The edge is cleared when an application is deleted, so a match can
            // carry an id whose record has just gone; read it, never assume it.
            const application = m.applicationId ? getApplication(m.applicationId) : undefined
            const lit = focus?.kind === 'match' && focus.id === m.id
            const fit = fitOf(profile, m.role, m.detail)
            return (
              <Row
                key={m.id}
                ref={lit ? focusedRow : undefined}
                className={cn('flex-wrap', lit && 'arrival-highlight rounded-md')}
              >
                <div className="min-w-0 flex-1 basis-64">
                  <div>{m.role}</div>
                  <div className="mt-0.5 text-xs text-text-3">{m.detail}</div>
                  {/* What it matched on, so a percentage is a claim the reader
                      can check rather than a number to be trusted. */}
                  {fit.matched.length > 0 ? (
                    <div className="mt-0.5 truncate text-xs text-text-3">
                      matched {listJoin(fit.matched.slice(0, 3))}
                    </div>
                  ) : null}
                  {fit.score === null ? (
                    <div className="mt-0.5 text-xs text-text-3">{fit.reason}</div>
                  ) : null}
                  {application ? (
                    <div className="mt-1 text-xs text-text-3">
                      In applications as{' '}
                      <Link
                        to={appPath(application)}
                        className="text-text-2 underline underline-offset-2 hover:text-text-1"
                      >
                        {displayName(application)}
                      </Link>
                    </div>
                  ) : null}
                </div>
                {/* No score rather than a made-up one. An empty profile has told
                    the app nothing to rank against, and a confident number over
                    nothing is exactly what the fixtures used to be. */}
                {fit.score === null ? (
                  <Chip tone="gray">not scored</Chip>
                ) : (
                  <Chip tone={fitTone(fit.score)}>{fit.score}% fit</Chip>
                )}
                {/* Promoting links the two rather than moving the match: the feed
                  is generated, so a mis-click on a row that vanished could not
                  be undone. Already-promoted rows say where they went. */}
                {application ? (
                  <Chip tone="teal">added</Chip>
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => onPromote(m.id)}>
                    Add to applications
                  </Button>
                )}
              </Row>
            )
          })}
        </RowList>
      )}
    </Panel>
  )
}
