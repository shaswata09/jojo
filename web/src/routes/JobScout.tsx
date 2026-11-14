import { useState } from 'react'
import { MatchesPanel } from '@/components/scout/MatchesPanel'
import { PipelineDialog } from '@/components/scout/PipelineDialog'
import { PipelinesPanel } from '@/components/scout/PipelinesPanel'
import { PostingsPanel } from '@/components/scout/PostingsPanel'
import { ProposalQueue } from '@/components/scout/ProposalQueue'
import { PausedNotice, RunsLocallyNote, ScoutHeader } from '@/components/scout/ScoutHeader'
import { ShutdownDialog } from '@/components/scout/ShutdownDialog'
import { useFillDraft } from '@/components/scout/use-fill-draft'
import { usePipelineActions } from '@/components/scout/use-pipeline-actions'
import { usePostingActions } from '@/components/scout/use-posting-actions'
import { usePostingPages } from '@/components/scout/use-posting-pages'
import { useProposalActions } from '@/components/scout/use-proposal-actions'
import { FilePreviewDialog } from '@/components/vault/FilePreviewDialog'
import type { VaultFile } from '@/data/vault'
import { useApplications } from '@jojo/service/react/use-applications'
import { useProfile } from '@jojo/service/react/use-profile'
import { useScout } from '@jojo/service/react/use-scout'
import { usePipelinesState } from '@jojo/service/react/pipelines-context'
import { useTitle } from '@/lib/links'
import { useScoutParams } from '@/lib/link-params'
import { useArrivalHighlight, useArrivalScroll } from '@/lib/use-arrival-highlight'
import { jobFromApproval } from '@jojo/service/core/proposal'

export function JobScout() {
  useTitle('Job scout')
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
  const scout = useScout()
  const { matches, postings, pipelines } = scout
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

  // Arrived from a graph node or a query row naming a match or a saved posting.
  // Both lists live on this page and their ids come from different collections,
  // so the parameter names the list too — see `ScoutFocus` in links.ts.
  const { focus, token, set } = useScoutParams()
  useArrivalHighlight(token, () => set({ focus: undefined }))
  const focusedRow = useArrivalScroll<HTMLDivElement>(token)

  const pages = usePostingPages()
  const [snapshot, setSnapshot] = useState<VaultFile | null>(null)
  const fillDraft = useFillDraft(pages)
  const pipelineActions = usePipelineActions(scout, engine)
  const { editing, setEditing } = pipelineActions
  const posting = usePostingActions(scout, pages, fillDraft)
  const proposal = useProposalActions(scout, engine, pages, fillDraft)

  const visiblePipelines = pipelines.filter((p) => !onlyActive || p.enabled)

  return (
    <>
      <ScoutHeader
        onlyActive={onlyActive}
        onOnlyActive={setOnlyActive}
        onNew={() => setEditing('new')}
      />

      {engine.paused ? <PausedNotice /> : null}

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
        onDelete={pipelineActions.onDelete}
        onToggle={pipelineActions.onToggle}
        onSetAuto={pipelineActions.onSetAuto}
        onRunNow={pipelineActions.onRunNow}
      />

      {/* Above the matches and the postings: it is the only panel on the page
          that is asking the reader for something. */}
      <ProposalQueue
        proposals={engine.proposals}
        pipelines={engine.pipelines}
        onApprove={proposal.onApprove}
        onDiscard={proposal.onDiscard}
        onApproveAll={proposal.onApproveAll}
        onSweep={engine.sweep}
        onClearAll={proposal.onClearAll}
        jobFor={(p) => jobFromApproval(p, matches, postings)}
        onPromote={posting.onPromoteJob}
      />

      <MatchesPanel
        matches={matches}
        getApplication={get}
        profile={profile}
        focus={focus}
        focusedRow={focusedRow}
        onPromote={posting.onPromote}
      />

      <PostingsPanel
        postings={postings}
        getApplication={get}
        focus={focus}
        focusedRow={focusedRow}
        url={posting.url}
        onUrlChange={posting.setUrl}
        onSave={posting.onSavePosting}
        onPromote={posting.onPromotePosting}
        onRemove={posting.onRemovePosting}
        pageFor={pages.pageFor}
        isKeeping={pages.isKeeping}
        onOpenPage={setSnapshot}
        onKeepPage={(p) => pages.keepAndReport(p.url, p.title)}
      />

      <FilePreviewDialog
        file={snapshot}
        onClose={() => setSnapshot(null)}
        description={(name) =>
          `The page kept for this posting, ${name}. Press Escape to go back to Job scout.`
        }
      />

      <RunsLocallyNote />

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
          onSave={pipelineActions.savePipeline}
        />
      ) : null}
    </>
  )
}
