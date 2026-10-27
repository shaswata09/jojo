import { useState } from 'react'
import { Plus, Radar, TriangleAlert } from 'lucide-react'
import { useNavigate } from 'react-router'
import { draftFromUrl } from '@/components/applications/draft-from'
import { PageHeader, PageOption } from '@/components/common/PageHeader'
import { MatchesPanel } from '@/components/scout/MatchesPanel'
import { PipelineDialog } from '@/components/scout/PipelineDialog'
import type { PipelineDraft } from '@/components/scout/PipelineDialog'
import { PipelinesPanel } from '@/components/scout/PipelinesPanel'
import { PostingsPanel } from '@/components/scout/PostingsPanel'
import { ProposalQueue } from '@/components/scout/ProposalQueue'
import { ShutdownDialog } from '@/components/scout/ShutdownDialog'
import { FilePreviewDialog } from '@/components/vault/FilePreviewDialog'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { Pipeline, SavedPosting } from '@/data/scout'
import type { VaultFile } from '@/data/vault'
import { useApplications } from '@jojo/service/react/use-applications'
import { useProfile } from '@jojo/service/react/use-profile'
import { useGraph } from '@jojo/service/react/kg-context'
import { useVault } from '@jojo/service/react/use-vault'
import { useScout } from '@jojo/service/react/use-scout'
import { usePipelinesState } from '@jojo/service/react/pipelines-context'
import { appPath, scoutPath, useTitle } from '@/lib/links'
import { useScoutParams } from '@/lib/link-params'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { useFillFromPosting } from '@/lib/fill-from-posting'
import { isConfigured } from '@/lib/llm'
import { useKeepPostingPage } from '@/lib/posting-agent'
import type { KeptPage } from '@/lib/posting-agent'
import { useUndoable } from '@/lib/undo'
import { useArrivalHighlight, useArrivalScroll } from '@/lib/use-arrival-highlight'
import { report } from '@/lib/analytics'
import { kindOf } from '@jojo/service/react/use-pipelines'
import { jobFromApproval, postingPreview } from '@jojo/service/core/proposal'
import { postingIdentity } from '@jojo/service/core/capture'
import { postingSourceForUrl } from '@jojo/service/core/posting-source'
import type { ApprovedJob } from '@jojo/service/core/proposal'

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
  // The matches are scored against this rather than shipped with a number.
  const { profile } = useProfile()

  /*
   * The engine is mounted above the router (`lib/pipelines.tsx`), not here.
   *
   * Calling `usePipelines` from this route made a pipeline's lifetime this
   * page's lifetime: navigating away cleared its interval and aborted the round
   * in flight, while the panel below went on promising they "work while this tab
   * is open". This page is a view of the engine now, the same way the Assistant
   * is a view of a run.
   */
  const engine = usePipelinesState()

  const navigate = useNavigate()
  // Arrived from a graph node or a query row naming a match or a saved posting.
  // Both lists live on this page and their ids come from different collections,
  // so the parameter names the list too — see `ScoutFocus` in links.ts.
  const { focus, token, set } = useScoutParams()
  useArrivalHighlight(token, () => set({ focus: undefined }))
  const focusedRow = useArrivalScroll<HTMLDivElement>(token)
  const { toast } = useToast()
  const undoable = useUndoable()
  const [url, setUrl] = useState('')

  /*
   * The page behind each posting, kept the way "From link" keeps one.
   *
   * A saved posting used to be a URL and a date: the scout found the job, the
   * person approved it, and the page itself — the requirements, the deadline,
   * the thing the listing coming down takes with it — was never kept, though
   * the button to open it sat disabled on every row. See `useKeepPostingPage`.
   */
  const keepPage = useKeepPostingPage()
  const { reader, settings } = useModelSettings()
  const fillFromPosting = useFillFromPosting()
  const graph = useGraph()
  const { files } = useVault()
  /** Postings whose page is being kept right now, by identity. */
  const [keeping, setKeeping] = useState<ReadonlySet<string>>(() => new Set())
  const [snapshot, setSnapshot] = useState<VaultFile | null>(null)
  const keyOf = (postingUrl: string) => postingIdentity(postingUrl) ?? postingUrl

  const pageFor = (posting: SavedPosting): VaultFile | null => {
    const source = postingSourceForUrl(graph, posting.url)
    return source ? (files.find((f) => f.id === source.fileId) ?? null) : null
  }

  /** Says how keeping one page went. Quiet when it was already in the Vault. */
  const reportKept = (kept: KeptPage, title: string) => {
    if (!kept.ok) {
      toast({ title: 'The posting’s page was not saved', description: kept.reason, tone: 'danger' })
      return
    }
    if (kept.via === 'already') return
    toast({
      title: 'Posting page saved',
      description: kept.filedUnder
        ? `${title} — filed under its application.`
        : `${title} — in the Vault under Job postings.`,
    })
  }

  const keepPostingPage = async (postingUrl: string, title: string): Promise<KeptPage> => {
    const key = keyOf(postingUrl)
    setKeeping((now) => new Set(now).add(key))
    try {
      return await keepPage({ url: postingUrl, title, reader })
    } finally {
      setKeeping((now) => {
        const next = new Set(now)
        next.delete(key)
        return next
      })
    }
  }

  const keepAndReport = (postingUrl: string, title: string) =>
    void keepPostingPage(postingUrl, title).then((kept) => reportKept(kept, title))

  const savePipeline = (draft: PipelineDraft) => {
    if (editing && editing !== 'new') {
      updatePipeline(editing.id, draft)
      toast({ title: 'Pipeline updated', description: draft.name })
    } else {
      // Switched on: a new pipeline that arrived off would read as a create
      // that failed. Whether it can actually run is the model's business, and
      // the toast says which of the two just happened rather than asserting the
      // pessimistic one the way it used to.
      const pipeline = addPipeline({ ...draft, enabled: true })
      toast({
        title: 'Pipeline created',
        description: engine.paused
          ? `${pipeline.name} — paused until a model is connected.`
          : `${pipeline.name} — it will start looking shortly.`,
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

  /**
   * Turns a match into a real application and goes straight to it.
   *
   * The Undo carries the reader back to this page as well as reverting the
   * write. Without the navigation it would delete the record out from under the
   * detail route the promotion had just pushed them onto, and the page they were
   * looking at would empty itself while they were reading it.
   */
  const onPromote = (matchId: string) => {
    const { value: application, restore } = undoable(() => promoteToApplication(matchId))
    if (!application) return
    toast({
      title: `${application.org} added as a draft`,
      description: 'The match stays in this feed, now linked to the application.',
      action: restore
        ? {
            label: 'Undo',
            onClick: () => {
              restore()
              navigate(scoutPath({ focus: { kind: 'match', id: matchId } }))
            },
          }
        : undefined,
    })
    navigate(appPath(application))
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
    keepAndReport(text, title)
  }

  /** The second way in, and the one the panel copy promises. Same shape as the
   *  match promotion above: the posting stays filed, now linked, and the Undo
   *  reverts the write and brings the reader back off the detail route. */
  const onPromotePosting = (postingId: string) => {
    const posting = postings.find((p) => p.id === postingId)
    const { value: application, restore } = undoable(() => promotePosting(postingId))
    if (!application) return
    // A page already kept was filed under the application by the promote
    // itself. One that is not kept yet is kept now and filed when it lands —
    // or, when it is already on its way, filed by the capture in flight.
    if (posting && !pageFor(posting)) keepAndReport(posting.url, posting.title)
    toast({
      title: `${application.org} added as a draft`,
      description: 'The posting stays saved here, now linked to the application.',
      action: restore
        ? {
            label: 'Undo',
            onClick: () => {
              restore()
              navigate(scoutPath({ focus: { kind: 'posting', id: postingId } }))
            },
          }
        : undefined,
    })
    navigate(appPath(application))
  }

  const onPromoteJob = (job: ApprovedJob) =>
    job.kind === 'match' ? onPromote(job.id) : onPromotePosting(job.id)

  /**
   * The draft an approved job becomes, and — for a posting — the page read into it.
   *
   * Reported 2026-10-27: approving a scouted job filed it and stopped, so the
   * person had to press "Add to applications" for every job they had already
   * said yes to, and the draft that made was named off the address alone —
   * "CRA — Assistant professor manhattan kansas" for a Kansas State posting on
   * CRA's board. Approval now makes the draft itself, and the posting is read
   * the way "From link" reads one: the page is opened, the model is asked for
   * the employer, role, location, pay, deadline and posting ID, the page is
   * kept in the Vault and filed under the draft, and the draft is filled from
   * what the page said.
   *
   * The draft exists before the read finishes, from the address — so a read
   * that fails (no extension, no model, a sign-in wall) still leaves the job in
   * the applications, and says why the details are thin. Without a model there
   * is nothing to ask, and the page is only kept, as approval did before.
   */
  const draftFrom = (kind: ApprovedJob['kind'], id: string) =>
    kind === 'match' ? promoteToApplication(id) : promotePosting(id)

  const fillDraft = async (
    application: { id: string; org: string },
    postingUrl: string,
    title: string,
  ) => {
    if (!isConfigured(settings)) {
      keepAndReport(postingUrl, title)
      return
    }
    const key = keyOf(postingUrl)
    setKeeping((now) => new Set(now).add(key))
    try {
      const out = await fillFromPosting({
        applicationId: application.id,
        url: postingUrl,
        settings,
        reader,
      })
      if (!out.ok) {
        toast({
          title: `${application.org}: the posting could not be read`,
          description: `${out.reason} The draft keeps what its link says — open it to fill in the rest.`,
          tone: 'danger',
        })
        return
      }
      const name = out.name
      toast({
        title: out.filled.length > 0 ? `${name} filled from the posting` : `${name}: posting read`,
        description: [
          out.filled.length > 0
            ? `Filled in: ${out.filled.join(', ')}.`
            : 'The draft already had what the page says.',
          out.missing.length > 0 ? `Not on the page: ${out.missing.join(', ')}.` : '',
          'The page is filed under it.',
        ]
          .filter(Boolean)
          .join(' '),
        action: { label: 'Open', onClick: () => navigate(appPath({ id: out.application })) },
      })
    } finally {
      setKeeping((now) => {
        const next = new Set(now)
        next.delete(key)
        return next
      })
    }
  }

  /** One approval: the job filed, its draft made, and the page read into it. Returns the draft. */
  const approveOne = (id: string) => {
    const proposal = engine.proposals.find((p) => p.id === id)
    const made = engine.approve(id)
    if (
      !made ||
      !proposal ||
      (proposal.tool !== 'scout.match.save' && proposal.tool !== 'scout.posting.save')
    ) {
      return null
    }
    const kind = proposal.tool === 'scout.match.save' ? 'match' : 'posting'
    const application = draftFrom(kind, made)
    if (!application) return null
    const seen = kind === 'posting' ? postingPreview(proposal.tool, proposal.input) : null
    return {
      application,
      page: seen?.href ? { url: seen.href, title: seen.title ?? seen.label } : null,
    }
  }

  const onApproveProposal = (id: string) => {
    const done = approveOne(id)
    report('scout_proposal_decided', { decision: 'approved' })
    if (!done) return
    const { application, page } = done
    toast({
      title: `${application.org} added to your applications as a draft`,
      description: page
        ? isConfigured(settings)
          ? 'Reading the posting to fill in its details — the draft updates when it is done.'
          : 'Filled from its link. Connect a model in Settings to have the posting itself read in.'
        : 'Open it to fill in the rest.',
      action: { label: 'Open', onClick: () => navigate(appPath(application)) },
    })
    if (page) void fillDraft(application, page.url, page.title)
  }

  /**
   * Approve all: each job its own approval and its own draft, then the pages
   * read one at a time — each opens a tab and asks the model, and a dozen at
   * once would be a dozen tabs.
   */
  const onApproveAll = (pipelineId: string) => {
    const ids = engine.proposals
      .filter((p) => p.pipelineId === pipelineId && p.status === 'pending')
      .map((p) => p.id)
    const done = ids.flatMap((id) => {
      const one = approveOne(id)
      return one ? [one] : []
    })
    report('scout_proposal_decided', { decision: 'approved' })
    if (done.length === 0) return
    toast({
      title: `${String(done.length)} added to your applications as drafts`,
      description: isConfigured(settings)
        ? 'Reading each posting in turn to fill in its details.'
        : 'Filled from their links. Connect a model in Settings to have the postings themselves read in.',
    })
    void (async () => {
      for (const { application, page } of done) {
        if (page) await fillDraft(application, page.url, page.title)
      }
    })()
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

      {/* System status, stated plainly rather than implied by a colour — and
          read off the model settings rather than hardcoded, which is what it
          was while nothing could run either way. */}
      {engine.paused ? (
        <div
          role="status"
          className="flex items-start gap-2.5 rounded-lg border border-warning-border bg-warning-soft px-4 py-3 text-sm text-warning"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden />
          <p>
            No local model is connected, so pipelines are paused. You can still write them and save
            postings below — they start running once a model is reachable.
          </p>
        </div>
      ) : null}

      <PipelinesPanel
        pipelines={visiblePipelines}
        onlyActive={onlyActive}
        running={engine.running}
        activity={engine.activity}
        paused={engine.paused}
        pendingCount={(id) => engine.pendingFor(id).length}
        onShowAll={() => setOnlyActive(false)}
        onNew={() => setEditing('new')}
        onEdit={setEditing}
        onDelete={onDeletePipeline}
        onToggle={engine.setEnabled}
        onSetAuto={engine.setAuto}
        onRunNow={(id) => {
          engine.runNow(id)
          /*
           * The KIND, not the pipeline — its name is a saved search somebody
           * wrote, which frequently contains a role and a city. `kindOf` is the
           * same lookup the engine uses to pick the prompt, so the two agree by
           * construction rather than by a second list kept in step by hand.
           */
          const pipeline = engine.pipelines.find((p) => p.id === id)
          if (pipeline) report('scout_pipeline_started', { kind: kindOf(pipeline) })
        }}
      />

      {/* Above the matches and the postings: it is the only panel on the page
          that is asking the reader for something. */}
      <ProposalQueue
        proposals={engine.proposals}
        pipelines={engine.pipelines}
        onApprove={onApproveProposal}
        onDiscard={(id) => {
          engine.discard(id)
          report('scout_proposal_decided', { decision: 'declined' })
        }}
        onApproveAll={onApproveAll}
        onSweep={engine.sweep}
        onClearAll={engine.clearAll}
        jobFor={(p) => jobFromApproval(p, matches, postings)}
        onPromote={onPromoteJob}
      />

      <MatchesPanel
        matches={matches}
        getApplication={get}
        profile={profile}
        focus={focus}
        focusedRow={focusedRow}
        onPromote={onPromote}
      />

      <PostingsPanel
        postings={postings}
        getApplication={get}
        focus={focus}
        focusedRow={focusedRow}
        url={url}
        onUrlChange={setUrl}
        onSave={onSavePosting}
        onPromote={onPromotePosting}
        onRemove={onRemovePosting}
        pageFor={pageFor}
        isKeeping={(p) => keeping.has(keyOf(p.url))}
        onOpenPage={setSnapshot}
        onKeepPage={(p) => keepAndReport(p.url, p.title)}
      />

      <FilePreviewDialog
        file={snapshot}
        onClose={() => setSnapshot(null)}
        description={(name) =>
          `The page kept for this posting, ${name}. Press Escape to go back to Job scout.`
        }
      />

      <p className="flex items-center gap-2 text-xs text-text-3">
        <Radar className="size-3.5" strokeWidth={1.7} aria-hidden />
        Pipelines run on your machine, while this tab is open. Nothing is sent to a third party.
      </p>

      <ShutdownDialog
        pipeline={engine.shutdownOffer}
        onConfirm={engine.acceptShutdown}
        onDismiss={engine.dismissShutdown}
      />

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
