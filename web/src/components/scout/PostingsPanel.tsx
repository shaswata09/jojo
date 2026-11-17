import type { Ref } from 'react'
import { ExternalLink, FileText, LoaderCircle, Trash2 } from 'lucide-react'
import { Link } from 'react-router'
import { Trans, useTranslation } from 'react-i18next'
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
import type { VaultFile } from '@/data/vault'
import { appPath } from '@/lib/links'
import type { ScoutFocus } from '@/lib/links'
import { TODAY } from '@/lib/today'
import { cn } from '@/lib/utils'
import { useDomain } from '@/i18n/domain'

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
  pageFor,
  isKeeping,
  onOpenPage,
  onKeepPage,
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
  /** The page kept for this posting, when there is one. */
  pageFor: (posting: SavedPosting) => VaultFile | null
  /** Whether its page is being kept right now. */
  isKeeping: (posting: SavedPosting) => boolean
  onOpenPage: (page: VaultFile) => void
  /** Keep the page now — for a posting saved before pages were kept, or one that failed. */
  onKeepPage: (posting: SavedPosting) => void
}) {
  const { t } = useTranslation('scout')
  const domain = useDomain()
  return (
    <Panel>
      <PanelTitle hint={t('postings.hint')}>{t('postings.title')}</PanelTitle>
      <p className="mb-3 text-sm text-text-2">{t('postings.intro')}</p>

      <div className="flex flex-wrap gap-2">
        <div className="min-w-0 flex-1 basis-64">
          <Label htmlFor="posting-url" className="sr-only">
            {t('postings.urlLabel')}
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
          title={url.trim() ? undefined : t('postings.pasteFirst')}
          onClick={onSave}
        >
          {t('postings.save')}
        </Button>
      </div>

      <div className="mt-4">
        {postings.length === 0 ? (
          <EmptyState
            icon={ExternalLink}
            title={t('postings.emptyTitle')}
            description={t('postings.emptyDescription')}
          />
        ) : (
          <RowList>
            {postings.map((p) => {
              // The edge is cleared when an application is deleted, so a
              // posting can carry an id whose record has just gone.
              const application = p.applicationId ? getApplication(p.applicationId) : undefined
              const lit = focus?.kind === 'posting' && focus.id === p.id
              const page = pageFor(p)
              const keeping = !page && isKeeping(p)
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
                          never fetched, so the stored `size` is not shown —
                          only the URL and the date, both real. Whether a page
                          was kept is the snapshot button's to say. */}
                      <span className="mt-0.5 block truncate font-mono text-xs text-text-3">
                        {hostOf(p.url) ?? p.url} ·{' '}
                        {t('postings.saved', { when: domain.ago(p.savedOn, TODAY) })}
                      </span>
                    </a>
                    {/* What the scout read on the board, kept once the posting
                        is saved, so the row says what the job is after the
                        suggestion card that first said it has gone. */}
                    {p.summary ? (
                      <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-text-2">
                        {p.summary}
                      </p>
                    ) : null}
                    {application ? (
                      <div className="mt-1 text-xs text-text-3">
                        <Trans
                          t={t}
                          i18nKey="common.inApplicationsAs"
                          values={{ name: displayName(application) }}
                          components={{
                            anchor: (
                              <Link
                                to={appPath(application)}
                                className="text-text-2 underline underline-offset-2 hover:text-text-1"
                              />
                            ),
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <Chip tone={p.linked ? 'teal' : 'gray'}>
                    {p.linked ? t('postings.linked') : t('postings.unscored')}
                  </Chip>
                  {/* Three states, each saying what is true: the page is kept,
                      it is being kept, or it is not — and then the button that
                      keeps it, rather than one that claims a copy jojo does not
                      have. */}
                  {page ? (
                    <Button variant="ghost" size="sm" onClick={() => onOpenPage(page)}>
                      <FileText className="size-3.5" strokeWidth={1.8} aria-hidden />
                      {t('postings.openSnapshot')}
                    </Button>
                  ) : keeping ? (
                    <Button variant="ghost" size="sm" disabled>
                      <LoaderCircle
                        className="size-3.5 animate-spin motion-reduce:animate-none"
                        strokeWidth={1.8}
                        aria-hidden
                      />
                      {t('postings.savingPage')}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      title={t('postings.savePageTitle')}
                      onClick={() => onKeepPage(p)}
                    >
                      {t('postings.savePage')}
                    </Button>
                  )}
                  {/* The way out of the panel, and the thing its copy
                      promises. Absent on a row that already went, the way a
                      promoted match reads 'added' rather than offering the
                      trip twice. */}
                  {p.linked ? null : (
                    <Button variant="ghost" size="sm" onClick={() => onPromote(p.id)}>
                      {t('common.addToApplications')}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('postings.remove', { title: p.title })}
                    aria-label={t('postings.remove', { title: p.title })}
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
