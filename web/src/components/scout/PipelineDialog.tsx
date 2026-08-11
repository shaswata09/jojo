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
import type { Pipeline } from '@/data/scout'

/** Everything a pipeline is, minus the two fields the list itself owns. */
export type PipelineDraft = Omit<Pipeline, 'id' | 'enabled'>

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
