import type { Ref } from 'react'
import { ExternalLink, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { hostOf } from '@/components/vault/links/url'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SavedPosting } from '@/data/scout'
import { displayName } from '@/data/seed'
import type { Application } from '@/data/seed'
import { agoLabel } from '@/data/timeline'
import { appPath } from '@/lib/links'
import type { ScoutFocus } from '@/lib/links'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'

/**
 * Postings are stored the way they are typed, and the seeded ones carry no
 * scheme — 'jobs.rice.edu/postings/29411'. An href like that is a *relative*
 * URL, so the browser would resolve it against this app's origin and land on a
 * jojo route that does not exist rather than on the job ad.
 */
function hrefOf(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

export function PostingsPanel({
  postings,
  getApplication,
  focus,
  focusedRow,
  url,
  onUrlChange,
  onSave,
  onPromote,
  onRemove,
}: {
  postings: readonly SavedPosting[]
  getApplication: (id: string) => Application | undefined
  focus: ScoutFocus | undefined
  /** Attached to the row a link arrived naming, so it scrolls itself into view. */
  focusedRow: Ref<HTMLDivElement>
  url: string
  onUrlChange: (url: string) => void
  onSave: () => void
  onPromote: (postingId: string) => void
  onRemove: (id: string, title: string) => void
}) {
  return (
    <Panel>
      <PanelTitle hint="works without a model">Save a posting</PanelTitle>
      <p className="mb-3 text-sm text-text-2">
        Nothing here fetches the page, so what is kept is the URL, the employer guessed from it, and
        the day you saved it — enough to find the ad again, and to apply from.
      </p>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Label htmlFor="posting-url" className="sr-only">
            Job posting URL
          </Label>
          <Input
            id="posting-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => onUrlChange(e.target.value)}
            placeholder="https://university.edu/careers/assistant-professor-12345"
            className="font-mono text-xs"
          />
        </div>
        <Button
          size="sm"
          disabled={!url.trim()}
          title={url.trim() ? undefined : 'Paste a URL first'}
          onClick={onSave}
        >
          Save posting
        </Button>
      </div>

      <div className="mt-4">
        {postings.length === 0 ? (
          <EmptyState
            icon={ExternalLink}
            title="No postings saved"
            description="Paste the URL of an ad you want to come back to. Ads are taken down; the link and the date are yours."
          />
        ) : (
          <RowList>
            {postings.map((p) => {
              // The edge is cleared when an application is deleted, so a
              // posting can carry an id whose record has just gone.
              const application = p.applicationId ? getApplication(p.applicationId) : undefined
              const lit = focus?.kind === 'posting' && focus.id === p.id
              return (
                <Row
                  key={p.id}
                  ref={lit ? focusedRow : undefined}
                  className={cn('flex-wrap', lit && 'arrival-highlight rounded-md')}
                >
                  <div className="min-w-0 flex-1 basis-64">
                    {/* The whole title block is the link — a posting you
                        cannot open is not a lead. The row's buttons stay
                        outside it, or clicking one would also follow the
                        anchor, and so does the line below for the same
                        reason: an anchor cannot hold another anchor. */}
                    <a
                      href={hrefOf(p.url)}
                      target="_blank"
                      // noreferrer as well as noopener: the employer's site
                      // should not learn which page the click came from.
                      rel="noopener noreferrer"
                      className="group block"
                    >
                      <span className="flex items-center gap-1.5">
                        <span className="truncate group-hover:underline">{p.title}</span>
                        <ExternalLink
                          aria-hidden
                          strokeWidth={1.7}
                          className="size-3.5 shrink-0 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
                        />
                      </span>
                      {/* The seed carries a page size for pages that were
                          never fetched. Printing it here would restate exactly
                          the claim the disabled button below denies, so only
                          the URL and the date — both real — are shown. */}
                      <span className="mt-0.5 block truncate font-mono text-xs text-text-3">
                        {hostOf(p.url) ?? p.url} · saved {agoLabel(p.savedOn, TODAY)}
                      </span>
                    </a>
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
                  <Chip tone={p.linked ? 'teal' : 'gray'}>
                    {p.linked ? 'linked to application' : 'unscored'}
                  </Chip>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled
                    title="No page was ever fetched, so there is no snapshot to open — showing one would claim a copy jojo does not have"
                  >
                    Open snapshot
                  </Button>
                  {/* The way out of the panel, and the thing its copy
                      promises. Absent on a row that already went, the way a
                      promoted match reads 'added' rather than offering the
                      trip twice. */}
                  {p.linked ? null : (
                    <Button variant="ghost" size="sm" onClick={() => onPromote(p.id)}>
                      Add to applications
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={`Remove ${p.title}`}
                    aria-label={`Remove ${p.title}`}
                    onClick={() => onRemove(p.id, p.title)}
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                  </Button>
                </Row>
              )
            })}
          </RowList>
        )}
      </div>
    </Panel>
  )
}
