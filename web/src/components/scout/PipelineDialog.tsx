import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { FormEvent } from 'react'
import { Field, FormField } from '@/components/common/Field'
import { Segment } from '@/components/common/Segment'
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
import { PIPELINE_SCHEDULES, scheduleOf } from '@jojo/service/core/proposal'
import type { PipelineKind } from '@jojo/service/core/model'
import type { Pipeline } from '@/data/scout'
import { contentModal } from '@/components/ui/dialog-width'

/** What the form collects. Not `Omit<Pipeline, …>`: the run-state fields on a
 *  pipeline are written by the runner and have no business in a form. */
export type PipelineDraft = {
  name: string
  source: string
  schedule: string
  filter: string
  kind: PipelineKind
}

/** The two kinds, labelled where they are rendered — `dialog.kinds.*` in the reader's language. */
const KINDS = ['twin', 'scout'] as const

export function PipelineDialog({
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
  const { t } = useTranslation('scout')
  const frequencies = PIPELINE_SCHEDULES.map((value) => ({
    value,
    label: t(`dialog.schedules.${value}`),
  }))
  const kinds = KINDS.map((value) => ({ value, label: t(`dialog.kinds.${value}`) }))
  const [kind, setKind] = useState<PipelineKind>(initial?.kind ?? 'scout')
  const [name, setName] = useState(initial?.name ?? '')
  const [source, setSource] = useState(initial?.source === '—' ? '' : (initial?.source ?? ''))
  const [terms, setTerms] = useState(initial?.filter === '—' ? '' : (initial?.filter ?? ''))
  const [schedule, setSchedule] = useState(scheduleOf(initial?.schedule ?? 'daily'))
  // Raised by a save attempt rather than by typing, so an untouched field is
  // not marked wrong before anyone has reached it.
  const [submitted, setSubmitted] = useState(false)

  /*
   * A twin reads the records it already has, so it has no source to name and
   * the field would be a question with no answer. The scout keeps the
   * requirement it always had.
   */
  const needsSource = kind === 'scout'
  const nameError = submitted && !name.trim() ? t('dialog.nameError') : undefined
  const sourceError =
    submitted && needsSource && !source.trim() ? t('dialog.sourceError') : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    setSubmitted(true)
    if (!name.trim() || (needsSource && !source.trim())) return

    onSave({
      name: name.trim(),
      // The seed writes an em dash where a pipeline has nothing to say in a
      // field, and the row prints these verbatim — an empty string leaves a
      // dangling separator in the middle of the line.
      source: source.trim() || '—',
      schedule,
      filter: terms.trim() || '—',
      kind,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={contentModal}>
        <DialogHeader>
          <DialogTitle>{initial ? t('dialog.editTitle') : t('common.newPipeline')}</DialogTitle>
          <DialogDescription>{t('dialog.description')}</DialogDescription>
        </DialogHeader>

        {/* noValidate so the browser's own bubble cannot fire ahead of the
            message written for the field. `required` stays on for the a11y tree. */}
        <form noValidate onSubmit={submit} className="grid gap-3.5">
          {/* Only when creating. A pipeline's kind decides which agent runs and
              which tools it may reach, so changing it under a queue of
              suggestions raised by the other one would leave cards whose rules
              no longer match their pipeline. `scout.pipeline.update` refuses it
              for the same reason; making a new one is the cheap alternative. */}
          {initial ? null : (
            <FormField
              label={t('dialog.kind')}
              hint={kind === 'twin' ? t('dialog.kindHint.twin') : t('dialog.kindHint.scout')}
            >
              <Segment label={t('dialog.kind')} options={kinds} value={kind} onChange={setKind} />
            </FormField>
          )}

          <Field
            label={t('dialog.name')}
            required
            error={nameError}
            value={name}
            autoComplete="off"
            placeholder={
              kind === 'twin' ? t('dialog.namePlaceholder.twin') : t('dialog.namePlaceholder.scout')
            }
            onChange={(event) => setName(event.target.value)}
          />

          {needsSource ? (
            <Field
              label={t('dialog.sources')}
              required
              mono
              error={sourceError}
              hint={t('dialog.sourcesHint')}
              value={source}
              autoComplete="off"
              placeholder="cra.org/ads"
              onChange={(event) => setSource(event.target.value)}
            />
          ) : null}

          <Field
            label={kind === 'twin' ? t('dialog.terms.twin') : t('dialog.terms.scout')}
            hint={kind === 'twin' ? t('dialog.termsHint.twin') : t('dialog.termsHint.scout')}
            value={terms}
            autoComplete="off"
            placeholder={
              kind === 'twin'
                ? t('dialog.termsPlaceholder.twin')
                : t('dialog.termsPlaceholder.scout')
            }
            onChange={(event) => setTerms(event.target.value)}
          />

          <FormField label={t('dialog.howOften')} hint={t('dialog.howOftenHint')}>
            <Segment
              label={t('dialog.howOften')}
              options={frequencies}
              value={schedule}
              onChange={setSchedule}
            />
          </FormField>

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {t('dialog.cancel')}
              </Button>
            </DialogClose>
            {/* Left enabled while the required fields are empty: pressing it
                names the one that is missing, where a disabled button leaves
                the reader hunting for it. */}
            <Button type="submit">{initial ? t('dialog.save') : t('dialog.create')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
