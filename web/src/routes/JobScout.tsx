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
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import type { Pipeline } from '@/data/scout'
import { useApplications } from '@jojo/service/react/use-applications'
import { useScout } from '@jojo/service/react/use-scout'
import { appPath, scoutPath, useScoutParams, useTitle } from '@/lib/links'
import { useToast } from '@/lib/toast-context'
import { useUndoable } from '@/lib/undo'
import { useArrivalHighlight, useArrivalScroll } from '@/lib/use-arrival-highlight'

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
  const undoable = useUndoable()
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
  }

  /** The second way in, and the one the panel copy promises. Same shape as the
   *  match promotion above: the posting stays filed, now linked, and the Undo
   *  reverts the write and brings the reader back off the detail route. */
  const onPromotePosting = (postingId: string) => {
    const { value: application, restore } = undoable(() => promotePosting(postingId))
    if (!application) return
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

      <PipelinesPanel
        pipelines={visiblePipelines}
        onlyActive={onlyActive}
        onShowAll={() => setOnlyActive(false)}
        onNew={() => setEditing('new')}
        onEdit={setEditing}
        onDelete={onDeletePipeline}
        onToggle={(p, enabled) => updatePipeline(p.id, { enabled })}
      />

      <MatchesPanel
        matches={matches}
        getApplication={get}
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
      />

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
