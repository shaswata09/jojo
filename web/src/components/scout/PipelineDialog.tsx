import { useState } from 'react'
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

/** What the form collects. Not `Omit<Pipeline, …>`: the run-state fields on a
 *  pipeline are written by the runner and have no business in a form. */
export type PipelineDraft = {
  name: string
  source: string
  schedule: string
  filter: string
  kind: PipelineKind
}

const FREQUENCIES = PIPELINE_SCHEDULES.map((value) => ({
  value,
  label: value.charAt(0).toUpperCase() + value.slice(1),
}))

const KINDS = [
  { value: 'twin', label: 'Keep records complete' },
  { value: 'scout', label: 'Find postings' },
] as const

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
  const nameError = submitted && !name.trim() ? 'Name it after what it watches.' : undefined
  const sourceError =
    submitted && needsSource && !source.trim()
      ? 'A scout with no source has nothing to read.'
      : undefined

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
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{initial ? 'Edit pipeline' : 'New pipeline'}</DialogTitle>
          <DialogDescription>
            A pipeline is a standing job for the assistant. It runs on this device while jojo is
            open, and everything it wants to change is shown to you first.
          </DialogDescription>
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
              label="What it does"
              hint={
                kind === 'twin'
                  ? 'Reads what you have and suggests what is missing — notes, reminders, tags, filing.'
                  : 'Looks for postings worth your attention and puts them up for review.'
              }
            >
              <Segment label="What it does" options={KINDS} value={kind} onChange={setKind} />
            </FormField>
          )}

          <Field
            label="Name"
            required
            error={nameError}
            value={name}
            autoComplete="off"
            placeholder={kind === 'twin' ? 'e.g. Keep my applications tidy' : 'e.g. CRA faculty job board'}
            onChange={(event) => setName(event.target.value)}
          />

          {needsSource ? (
            <Field
              label="Sources"
              required
              mono
              error={sourceError}
              hint="The board or careers page it watches. Separate several with commas."
              value={source}
              autoComplete="off"
              placeholder="cra.org/ads"
              onChange={(event) => setSource(event.target.value)}
            />
          ) : null}

          <Field
            label={kind === 'twin' ? 'What to focus on' : 'Match terms'}
            hint={
              kind === 'twin'
                ? 'Anything it should pay particular attention to. Leave blank to let it look everywhere.'
                : 'What a posting is scored against. Leave blank to keep everything the source lists.'
            }
            value={terms}
            autoComplete="off"
            placeholder={
              kind === 'twin' ? 'follow-ups and deadlines' : 'assistant professor, CS/ECE'
            }
            onChange={(event) => setTerms(event.target.value)}
          />

          <FormField label="How often" hint="How long it waits between rounds.">
            <Segment
              label="How often"
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
