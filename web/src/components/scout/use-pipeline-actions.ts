import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PipelineDraft } from '@/components/scout/PipelineDialog'
import type { Pipeline } from '@/data/scout'
import type { useScout } from '@jojo/service/react/use-scout'
import type { PipelinesState } from '@jojo/service/react/use-pipelines'
import { useToast } from '@/lib/toast-context'
import { report } from '@/lib/analytics'
import { kindOf } from '@jojo/service/react/use-pipelines'
import { announceRefusal } from '@/components/common/write-result'
import { useMascot } from '@/lib/mascot-context'
import { CUES } from '@/lib/mascot-cues'

/** Creating, editing, deleting, switching and running pipelines. */
export function usePipelineActions(scout: ReturnType<typeof useScout>, engine: PipelinesState) {
  const { addPipeline, updatePipeline, removePipeline } = scout
  const { t } = useTranslation('scout')
  const { toast } = useToast()
  const mascot = useMascot()
  /** 'new' opens the create dialog; a pipeline opens the same dialog seeded. */
  const [editing, setEditing] = useState<Pipeline | 'new' | null>(null)

  const savePipeline = (draft: PipelineDraft) => {
    if (editing && editing !== 'new') {
      if (announceRefusal(updatePipeline(editing.id, draft), toast)) return
      toast({ title: t('toasts.pipelineUpdated'), description: draft.name })
    } else {
      // Switched on: a new pipeline that arrived off would read as a create
      // that failed. Whether it can actually run is the model's business, and
      // the toast says which of the two just happened rather than asserting the
      // pessimistic one the way it used to.
      const pipeline = addPipeline({ ...draft, enabled: true })
      toast({
        title: t('toasts.pipelineCreated'),
        description: engine.paused
          ? t('toasts.pipelineCreatedPaused', { name: pipeline.name })
          : t('toasts.pipelineCreatedRunning', { name: pipeline.name }),
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
      title: t('toasts.pipelineDeleted'),
      description: t('toasts.pipelineDeletedDescription', {
        name: pipeline.name,
        source: pipeline.source,
      }),
      tone: 'danger',
      action: { label: t('common.undo'), onClick: restore },
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
    mascot.play(CUES.scoutStarted)
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
