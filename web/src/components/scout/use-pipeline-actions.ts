import { useState } from 'react'
import type { PipelineDraft } from '@/components/scout/PipelineDialog'
import type { Pipeline } from '@/data/scout'
import type { useScout } from '@jojo/service/react/use-scout'
import type { PipelinesState } from '@jojo/service/react/use-pipelines'
import { useToast } from '@/lib/toast-context'
import { report } from '@/lib/analytics'
import { kindOf } from '@jojo/service/react/use-pipelines'
import { announceRefusal } from '@/components/common/write-result'

/** Creating, editing, deleting, switching and running pipelines. */
export function usePipelineActions(scout: ReturnType<typeof useScout>, engine: PipelinesState) {
  const { addPipeline, updatePipeline, removePipeline } = scout
  const { toast } = useToast()
  /** 'new' opens the create dialog; a pipeline opens the same dialog seeded. */
  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null)

  const savePipeline = (draft: PipelineDraft) => {
    if (editing && editing !== 'new') {
      if (announceRefusal(updatePipeline(editing.id, draft), toast)) return
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
  const onDelete = (pipeline: Pipeline) => {
    const { restore } = removePipeline(pipeline.id)
    toast({
      title: 'Pipeline deleted',
      description: `${pipeline.name} stops watching ${pipeline.source}.`,
      tone: 'danger',
      action: { label: 'Undo', onClick: restore },
    })
  }

  const onToggle = (pipeline: Pipeline, enabled: boolean) => {
    announceRefusal(engine.setEnabled(pipeline, enabled), toast)
  }

  const onSetAuto = (pipeline: Pipeline, auto: boolean) => {
    announceRefusal(engine.setAuto(pipeline, auto), toast)
  }

  const onRunNow = (id: string) => {
    engine.runNow(id)
    /*
     * The KIND, not the pipeline — its name is a saved search somebody
     * wrote, which frequently contains a role and a city. `kindOf` is the
     * same lookup the engine uses to pick the prompt, so the two agree by
     * construction rather than by a second list kept in step by hand.
     */
    const pipeline = engine.pipelines.find((p) => p.id === id)
    if (pipeline) report('scout_pipeline_started', { kind: kindOf(pipeline) })
  }

  return { editing, setEditing, savePipeline, onDelete, onToggle, onSetAuto, onRunNow }
}
