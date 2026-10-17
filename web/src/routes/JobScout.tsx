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
import { useKeepPostingPage } from '@/lib/posting-agent'
import type { KeptPage } from '@/lib/posting-agent'
import { useUndoable } from '@/lib/undo'
import { useArrivalHighlight, useArrivalScroll } from '@/lib/use-arrival-highlight'
import { report } from '@/lib/analytics'
import { kindOf } from '@jojo/service/react/use-pipelines'
import { approvedLabel, jobFromApproval, postingPreview } from '@jojo/service/core/proposal'
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
  const { reader } = useModelSettings()
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
   * Approving a scout suggestion files the job and stops: the application is
   * the reader's second decision, not a side effect of the first. The toast is
   * where that second step is offered, because "approved" next to an unchanged
   * applications table read as the scout silently failing.
   */
  const onApproveProposal = (id: string) => {
    const tool = engine.proposals.find((p) => p.id === id)?.tool
    const made = engine.approve(id)
    report('scout_proposal_decided', { decision: 'approved' })
    if (!made || (tool !== 'scout.match.save' && tool !== 'scout.posting.save')) return
    const kind = tool === 'scout.match.save' ? 'match' : 'posting'
    if (kind === 'posting') {
      const proposal = engine.proposals.find((p) => p.id === id)
      const seen = proposal ? postingPreview(proposal.tool, proposal.input) : null
      if (seen?.href) keepAndReport(seen.href, seen.title ?? seen.label)
    }
    toast({
      title: approvedLabel(tool),
      description: 'Not in your applications yet — add it when you want to track it.',
      action: {
        label: 'Add to applications',
        onClick: () => onPromoteJob({ kind, id: made }),
      },
    })
  }

  /**
   * Approve all, and keep every approved posting's page — one at a time, since
   * each opens a tab, and reported once at the end rather than a toast apiece.
   */
  const onApproveAll = (pipelineId: string) => {
    const pages = engine.proposals
      .filter((p) => p.pipelineId === pipelineId && p.status === 'pending')
      .map((p) => postingPreview(p.tool, p.input))
      .flatMap((seen) => (seen?.href ? [{ url: seen.href, title: seen.title ?? seen.label }] : []))
    engine.approveAll(pipelineId)
    if (pages.length === 0) return
    void (async () => {
      let saved = 0
      let reason: string | undefined
      for (const page of pages) {
        const kept = await keepPostingPage(page.url, page.title)
        if (kept.ok) saved += 1
        else reason ??= kept.reason
      }
      const of = `${String(saved)} of ${String(pages.length)}`
      toast(
        reason === undefined
          ? { title: saved === 1 ? 'Posting page saved' : 'Posting pages saved', description: `${of} kept in the Vault under Job postings.` }
          : { title: `${of} posting pages saved`, description: reason, tone: saved === 0 ? 'danger' : undefined },
      )
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
