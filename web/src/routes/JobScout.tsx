import { useState } from 'react'
import type { FormEvent } from 'react'
import { ExternalLink, Pencil, Plus, Radar, Radio, Trash2, TriangleAlert } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { draftFromUrl } from '@/components/applications/draft-from'
import { Chip } from '@/components/common/Chip'
import { EmptyState } from '@/components/common/EmptyState'
import { Field, FormField } from '@/components/common/Field'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { Panel, PanelTitle, Row, RowList } from '@/components/common/Panel'
import { Segment } from '@/components/common/Segment'
import { StatusDot } from '@/components/common/StatusDot'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { Pipeline } from '@/data/scout'
import { displayName } from '@/data/seed'
import { agoLabel } from '@/data/timeline'
import { appPath, useScoutParams, useTitle } from '@/lib/links'
import { useApplications, useScout } from '@/lib/store-context'
import { useToast } from '@/lib/toast-context'
import { useArrivalHighlight, useArrivalScroll } from '@/lib/use-arrival-highlight'
import { cn } from '@/lib/utils'

/** Fit bands. A number alone doesn't say whether 64 is good. */
function fitTone(fit: number) {
  if (fit >= 80) return 'green' as const
  if (fit >= 60) return 'amber' as const
  return 'gray' as const
}

/**
 * Postings are stored the way they are typed, and the seeded ones carry no
 * scheme — 'jobs.rice.edu/postings/29411'. An href like that is a *relative*
 * URL, so the browser would resolve it against this app's origin and land on a
 * jojo route that does not exist rather than on the job ad.
 */
function hrefOf(url: string) {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`
}

/** Strips the scheme and any trailing slash, as the Vault's links list does. */
function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/* -------------------------------- pipelines ------------------------------- */

/** Everything a pipeline is, minus the two fields the list itself owns. */
type PipelineDraft = Omit<Pipeline, 'id' | 'enabled'>

const FREQUENCIES = [
  { value: 'hourly', label: 'Hourly' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
] as const

type Frequency = (typeof FREQUENCIES)[number]['value']

/** Seeded pipelines spell their schedule the same way, but a stray value would
 *  otherwise leave the segmented control with nothing selected. */
const frequencyOf = (schedule: string): Frequency =>
  FREQUENCIES.some((f) => f.value === schedule) ? (schedule as Frequency) : 'daily'

function PipelineDialog({
  open,
  onOpenChange,
  initial,
  onSave,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pass a pipeline to edit it; omit to create one. */
  initial?: Pipeline
  onSave: (draft: PipelineDraft) => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [terms, setTerms] = useState(initial?.filter === '—' ? '' : (initial?.filter ?? ''))
  const [schedule, setSchedule] = useState<Frequency>(frequencyOf(initial?.schedule ?? 'daily'))
  // Raised by a save attempt rather than by typing, so an untouched field is
  // not marked wrong before anyone has reached it.
  const [submitted, setSubmitted] = useState(false)

  const nameError = submitted && !name.trim() ? 'Name it after what it watches.' : undefined
  const sourceError =
    submitted && !source.trim() ? 'A pipeline with no source has nothing to read.' : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || !source.trim()) return

    onSave({
      name: name.trim(),
      source: source.trim(),
      schedule,
      // The seed writes an em dash for a pipeline that filters nothing, and the
      // row prints this field verbatim — an empty string would leave a dangling
      // separator in the middle of the line.
      filter: terms.trim() || '—',
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit pipeline' : 'New pipeline'}</DialogTitle>
          <DialogDescription>
            A pipeline is a saved search: where to look, what to look for, and how often. Matching
            itself waits on a local model, so a new one is created paused.
          </DialogDescription>
        </DialogHeader>

        {/* noValidate so the browser's own bubble cannot fire ahead of the
            message written for the field. `required` stays on for the a11y tree. */}
        <form noValidate onSubmit={submit} className="grid gap-3.5">
          <Field
            label="Name"
            required
            error={nameError}
            value={name}
            autoComplete="off"
            placeholder="e.g. CRA faculty job board"
            onChange={(event) => setName(event.target.value)}
          />

          <Field
            label="Sources"
            required
            mono
            error={sourceError}
            hint="The board or careers page it reads. Separate several with commas."
            value={source}
            autoComplete="off"
            placeholder="cra.org/ads"
            onChange={(event) => setSource(event.target.value)}
          />

          <Field
            label="Match terms"
            hint="What a posting is scored against. Leave blank to keep everything the source lists."
            value={terms}
            autoComplete="off"
            placeholder="assistant professor, CS/ECE"
            onChange={(event) => setTerms(event.target.value)}
          />

          <FormField label="Frequency" hint="How often it would run once a model is reachable.">
            <Segment
              label="Frequency"
              options={FREQUENCIES}
              value={schedule}
              onChange={setSchedule}
            />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </DialogClose>
            {/* Left enabled while the required fields are empty: pressing it
                names the one that is missing, where a disabled button leaves
                the reader hunting for it. */}
            <Button type="submit">{initial ? 'Save changes' : 'Create pipeline'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------- page ----------------------------------- */

export function JobScout() {
  useTitle('Job scout')
  /** 'new' opens the create dialog; a pipeline opens the same dialog seeded. */
  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null)
  // Page option: a long list of off pipelines buries the ones actually running.
  const [onlyActive, setOnlyActive] = useState(false)

  /**
   * Everything on this page is store-backed, pipelines included.
   *
   * They used to be route state, on the reasoning that nothing links to a
   * pipeline so it had no business in a reducer that exists to keep links
   * straight. The audit found what that actually cost: a pipeline someone had
   * just written was thrown away by a click on the sidebar, under a caption
   * promising it was kept for the visit — while the matches and postings beside
   * it, which are in the store, survived the same trip. One screen, two rules.
   */
  const {
    matches,
    postings,
    addPosting,
    removePosting,
    promoteToApplication,
    promotePosting,
    pipelines,
    addPipeline,
    updatePipeline,
    removePipeline,
  } = useScout()
  const { get } = useApplications()
  const navigate = useNavigate()
  // Arrived from a graph node or a query row naming a match or a saved posting.
  // Both lists live on this page and their ids come from different collections,
  // so the parameter names the list too — see `ScoutFocus` in links.ts.
  const { focus, token, set } = useScoutParams()
  useArrivalHighlight(token, () => set({ focus: undefined }))
  const focusedRow = useArrivalScroll<HTMLDivElement>(token)
  const { toast } = useToast()
  const [url, setUrl] = useState('')

  const savePipeline = (draft: PipelineDraft) => {
    if (editing && editing !== 'new') {
      updatePipeline(editing.id, draft)
      toast({ title: 'Pipeline updated', description: draft.name })
    } else {
      // Switched on, and the banner above already says why nothing runs. A new
      // pipeline that arrived off would read as a create that failed.
      const pipeline = addPipeline({ ...draft, enabled: true })
      toast({
        title: 'Pipeline created',
        description: `${pipeline.name} — paused until a model is connected.`,
      })
    }
    setEditing(null)
  }

  /**
   * A pipeline is several fields someone sat and wrote — but the store hands
   * back a real restore, so this is an undo like every other delete in the app
   * rather than the confirmation it used to need.
   */
  const onDeletePipeline = (pipeline: Pipeline) => {
    const { restore } = removePipeline(pipeline.id)
    toast({
      title: 'Pipeline deleted',
      description: `${pipeline.name} stops watching ${pipeline.source}.`,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  /** Turns a match into a real application and goes straight to it. */
  const onPromote = (matchId: string) => {
    const application = promoteToApplication(matchId)
    if (!application) return
    toast({
      title: `${application.org} added as a draft`,
      description: 'The match stays in this feed, now linked to the application.',
    })
    navigate(appPath(application.id))
  }

  /**
   * Files the posting. No page is fetched — nothing here can — so the record
   * says what it is: a URL you kept, with the employer guessed off it.
   */
  const onSavePosting = () => {
    const text = url.trim()
    if (!text) return
    const guess = draftFromUrl(text)
    const title = [guess.org, guess.role].filter(Boolean).join(' — ') || text
    addPosting({ title, url: text, size: '—' })
    setUrl('')
    toast({ title: 'Posting saved', description: title })
  }

  /** The second way in, and the one the panel copy promises. Same shape as the
   *  match promotion above: the posting stays filed, now linked. */
  const onPromotePosting = (postingId: string) => {
    const application = promotePosting(postingId)
    if (!application) return
    toast({
      title: `${application.org} added as a draft`,
      description: 'The posting stays saved here, now linked to the application.',
    })
    navigate(appPath(application.id))
  }

  /** A URL and a title, retyped in seconds — undo toast, no confirmation. */
  const onRemovePosting = (id: string, title: string) => {
    const { restore } = removePosting(id)
    toast({
      title: 'Posting removed',
      description: title,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  const visiblePipelines = pipelines.filter((p) => !onlyActive || p.enabled)

  return (
    <>
      <PageHeader
        title="Job scout"
        subtitle="Saved searches that will watch job boards for you — and somewhere to park postings today"
        settings={
          <PageOption
            label="Only active pipelines"
            hint="Hide the ones switched off"
            control={
              <Switch
                checked={onlyActive}
                onCheckedChange={setOnlyActive}
                aria-label="Only active pipelines"
              />
            }
          />
        }
        actions={
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="size-3.5" strokeWidth={2} aria-hidden />
            New pipeline
          </Button>
        }
      />

      {/* System status, stated plainly rather than implied by a colour. */}
      <div
        role="status"
        className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
      >
        <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
        <p>
          No local model is connected, so matching is paused. You can still write pipelines and save
          postings below — both are scored once a model is reachable.
        </p>
      </div>

      <Panel>
        <div className="mb-3.5 flex flex-wrap items-baseline justify-between gap-2">
          <PanelTitle className="mb-0" hint="run locally on a schedule">
            Pipelines
          </PanelTitle>
          <p className="text-xs text-text-3">Kept for this visit — nothing is written to disk</p>
        </div>

        {visiblePipelines.length === 0 ? (
          <EmptyState
            icon={Radio}
            title={onlyActive ? 'Nothing switched on' : 'No pipelines'}
            description={
              onlyActive
                ? 'Every pipeline you have is switched off. Turn one on, or drop the filter in the page options.'
                : 'A pipeline is a saved search — a board to watch, the terms that matter, and how often to look.'
            }
            action={
              onlyActive ? (
                <Button size="sm" variant="outline" onClick={() => setOnlyActive(false)}>
                  Show all pipelines
                </Button>
              ) : (
                <Button size="sm" onClick={() => setEditing('new')}>
                  <Plus className="size-3.5" strokeWidth={2} aria-hidden />
                  New pipeline
                </Button>
              )
            }
          />
        ) : (
          <RowList>
            {visiblePipelines.map((p) => (
              <Row key={p.id} className="flex-wrap">
                <StatusDot status={p.enabled ? 'warn' : 'off'} className="mt-1.5" />
                <div className="min-w-0 flex-1 basis-64">
                  <div>{p.name}</div>
                  <div className="mt-0.5 truncate font-mono text-xs text-text-3">
                    {p.source} · {p.schedule} · {p.filter}
                  </div>
                </div>
                <Chip tone={p.enabled ? 'amber' : 'gray'}>{p.enabled ? 'paused' : 'off'}</Chip>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={`Edit ${p.name}`}
                  aria-label={`Edit ${p.name}`}
                  onClick={() => setEditing(p)}
                >
                  <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  title={`Delete ${p.name}`}
                  aria-label={`Delete ${p.name}`}
                  onClick={() => onDeletePipeline(p)}
                >
                  <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
                </Button>
                <Switch
                  checked={p.enabled}
                  onCheckedChange={(enabled) => updatePipeline(p.id, { enabled })}
                  aria-label={`Enable ${p.name}`}
                />
              </Row>
            ))}
          </RowList>
        )}
      </Panel>

      <Panel>
        {/* The hint used to read "last run Oct 11". Nothing has ever run — the
            banner above says matching is paused — so the date was a claim the
            rest of the page denies. These are the seeded examples. */}
        <PanelTitle hint="example scores">Matches</PanelTitle>

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
              const application = m.applicationId ? get(m.applicationId) : undefined
              const lit = focus?.kind === 'match' && focus.id === m.id
              return (
                <Row
                  key={m.id}
                  ref={lit ? focusedRow : undefined}
                  className={cn('flex-wrap', lit && 'arrival-highlight rounded-md')}
                >
                  <div className="min-w-0 flex-1 basis-64">
                    <div>{m.role}</div>
                    <div className="mt-0.5 text-xs text-text-3">{m.detail}</div>
                    {application ? (
                      <div className="mt-1 text-xs text-text-3">
                        In applications as{' '}
                        <Link
                          to={appPath(application.id)}
                          className="text-text-2 underline underline-offset-2 hover:text-text-1"
                        >
                          {displayName(application)}
                        </Link>
                      </div>
                    ) : null}
                  </div>
                  <Chip tone={fitTone(m.fit)}>{m.fit}% fit</Chip>
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

      <Panel>
        <PanelTitle hint="works without a model">Save a posting</PanelTitle>
        <p className="mb-3 text-sm text-text-2">
          Nothing here fetches the page, so what is kept is the URL, the employer guessed from it,
          and the day you saved it — enough to find the ad again, and to apply from.
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
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://university.edu/careers/assistant-professor-12345"
              className="font-mono text-xs"
            />
          </div>
          <Button
            size="sm"
            disabled={!url.trim()}
            title={url.trim() ? undefined : 'Paste a URL first'}
            onClick={onSavePosting}
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
                const application = p.applicationId ? get(p.applicationId) : undefined
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
                          {hostOf(p.url)} · saved {agoLabel(p.savedOn)}
                        </span>
                      </a>
                      {application ? (
                        <div className="mt-1 text-xs text-text-3">
                          In applications as{' '}
                          <Link
                            to={appPath(application.id)}
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
                      <Button variant="ghost" size="sm" onClick={() => onPromotePosting(p.id)}>
                        Add to applications
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      title={`Remove ${p.title}`}
                      aria-label={`Remove ${p.title}`}
                      onClick={() => onRemovePosting(p.id, p.title)}
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

      <p className="flex items-center gap-2 text-xs text-text-3">
        <Radar className="size-3.5" strokeWidth={1.7} aria-hidden />
        Pipelines run on your machine. Nothing is sent to a third party.
      </p>

      {editing ? (
        <PipelineDialog
          // Keyed so opening a second pipeline while one is up re-seeds the
          // form rather than leaving the first one's values in the fields.
          key={editing === 'new' ? 'new' : editing.id}
          open
          onOpenChange={(open) => {
            if (!open) setEditing(null)
          }}
          initial={editing === 'new' ? undefined : editing}
          onSave={savePipeline}
        />
      ) : null}
    </>
  )
}
