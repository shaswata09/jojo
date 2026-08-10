import { useId, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { Field, FormField, TextareaField } from '@/components/common/Field'
import {
  buildInput,
  fieldOfPath,
  initialValues,
  optionLabel,
  recordOptions,
} from '@/components/common/tool-form'
import type { FieldPlan, FormPlan, FormValues, RecordOption } from '@/components/common/tool-form'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useGraph, useKg } from '@/kg/react/kg-context'
import { useRun } from '@/kg/react/use-tool'
import type { ToolName } from '@/kg/tools'
import { useToast } from '@/lib/toast-context'

/** Matches the pickers in `QueryPanel.tsx:46-47` — the app's one select skin. */
const SELECT_CLASS =
  'h-8 w-full cursor-pointer rounded-lg border border-input bg-transparent px-2 text-sm text-text-1 transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50'

type Problem = { field: string; message: string }

/** A labelled control that is not an `<input>`, so `Field` cannot wrap it. */
function ControlField({
  plan,
  error,
  children,
}: {
  plan: FieldPlan
  error?: string
  children: (id: string) => ReactNode
}) {
  const id = useId()
  return (
    <FormField
      label={plan.label}
      htmlFor={id}
      required={plan.required}
      {...(error === undefined ? {} : { error })}
      {...(plan.description === undefined ? {} : { hint: plan.description })}
    >
      {children(id)}
    </FormField>
  )
}

function GeneratedField({
  plan,
  value,
  error,
  onChange,
  options,
}: {
  plan: FieldPlan
  value: string | boolean
  error?: string
  onChange: (next: string | boolean) => void
  /** Already-built record options — the picker never reads the store itself. */
  options: readonly RecordOption[]
}) {
  const text = typeof value === 'string' ? value : ''
  const shared = {
    label: plan.label,
    required: plan.required,
    // Every message here arrives on submit, with focus still on the button, so
    // it is spoken rather than waited on until the field next takes focus.
    announce: true,
    ...(error === undefined ? {} : { error }),
    ...(plan.description === undefined ? {} : { hint: plan.description }),
    ...(plan.placeholder === undefined ? {} : { placeholder: plan.placeholder }),
  }

  switch (plan.control) {
    case 'textarea':
      return (
        <TextareaField
          {...shared}
          rows={3}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'text':
      return <Field {...shared} value={text} onChange={(event) => onChange(event.target.value)} />
    case 'date':
      return (
        <Field
          {...shared}
          type="date"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'number':
      return (
        <Field
          {...shared}
          type="number"
          inputMode="numeric"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      )
    case 'boolean':
      return (
        <ControlField plan={plan} {...(error === undefined ? {} : { error })}>
          {(id) => (
            <Switch id={id} checked={value === true} onCheckedChange={(next) => onChange(next)} />
          )}
        </ControlField>
      )
    case 'enum':
      return (
        <ControlField plan={plan} {...(error === undefined ? {} : { error })}>
          {(id) => (
            <select
              id={id}
              className={SELECT_CLASS}
              value={text}
              onChange={(event) => onChange(event.target.value)}
            >
              <option value="">{plan.required ? 'Choose…' : 'None'}</option>
              {(plan.options ?? []).map((option) => (
                <option key={String(option)} value={String(option)}>
                  {optionLabel(option)}
                </option>
              ))}
            </select>
          )}
        </ControlField>
      )
    case 'record':
      return (
        <ControlField plan={plan} {...(error === undefined ? {} : { error })}>
          {(id) => (
            <select
              id={id}
              className={SELECT_CLASS}
              value={text}
              onChange={(event) => onChange(event.target.value)}
            >
              <option value="">{plan.required ? 'Choose…' : 'None'}</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          )}
        </ControlField>
      )
  }
}

/**
 * Any tool, as a form, from its own input schema.
 *
 * This is the surface `core/schema.ts:6-13` was written for: one reader of
 * `FieldMeta` that both ⌘K and `/graph` open, so a tool gains a usable form the
 * moment it is registered rather than when somebody writes its dialog. It does
 * not replace the hand-written editors — `ApplicationDialog` knows about
 * keywords, offers and stage transitions, and `plan.omitted` names what this
 * form left out rather than pretending it covered everything.
 *
 * `useRun` rather than `useTool`, which is the same call with a toast on it. A
 * refusal belongs under the field that caused it, on a form that is still open
 * with everything the user typed still in it; `useTool` would say the same thing
 * a second time in a toast over the top of that. Only the success announcement
 * is a toast, and it carries the same generic Undo every card gets.
 */
export function ToolRunDialog({
  name,
  plan,
  seeded,
  onOpenChange,
}: {
  name: ToolName
  /**
   * Planned by the caller, because the caller had to plan it anyway to decide
   * whether to offer the row at all. Passing it down means the form drawn is
   * provably the form that was offered.
   */
  plan: FormPlan
  seeded?: Readonly<Record<string, unknown>>
  onOpenChange: (open: boolean) => void
}) {
  const memory = useGraph()
  const { runtime } = useKg()
  const run = useRun()
  const { toast } = useToast()

  const [values, setValues] = useState<FormValues>(() => initialValues(plan))
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set())
  const [problems, setProblems] = useState<readonly Problem[]>([])

  /**
   * One pass over the store per record type on the form, not per field.
   *
   * `timeline.item.create` draws one application picker and `keyword.attach`
   * would draw two of the same type; building the list inside the field would
   * walk and sort the whole type once for each of them on every keystroke.
   */
  const optionsByType = useMemo(() => {
    const map = new Map<string, RecordOption[]>()
    for (const field of plan.fields) {
      if (field.nodeType && !map.has(field.nodeType)) {
        map.set(field.nodeType, recordOptions(memory, field.nodeType))
      }
    }
    return map
  }, [plan, memory])

  const drawn = useMemo(() => new Set(plan.fields.map((f) => f.key)), [plan])
  const errorFor = (key: string) => problems.find((p) => p.field === key)?.message
  // Anything whose path names a field this form did not draw — a nested value,
  // or a refusal from `available`, which carries no field at all.
  const general = problems.filter((p) => !drawn.has(p.field))

  const submit = () => {
    const input = buildInput(plan, values, touched, seeded)

    // Parsed before it is run, so a blank employer never reaches a transaction
    // and the sentence under the field is the schema's own.
    const parsed = runtime.check(name, input)
    if (!parsed.ok) {
      setProblems(parsed.issues.map((i) => ({ field: fieldOfPath(i.path), message: i.message })))
      return
    }

    const result = run(name, parsed.value)
    if (!result.ok) {
      setProblems(result.errors.map((e) => ({ field: e.field ?? '', message: e.message })))
      return
    }

    const { announcement, undo } = result
    toast({
      title: announcement.title,
      ...(announcement.description === undefined ? {} : { description: announcement.description }),
      ...(announcement.tone === undefined ? {} : { tone: announcement.tone }),
      ...(undo === null ? {} : { action: { label: 'Undo', onClick: undo } }),
    })
    onOpenChange(false)
  }

  const set = (key: string, next: string | boolean) => {
    setValues((current) => ({ ...current, [key]: next }))
    setTouched((current) => (current.has(key) ? current : new Set([...current, key])))
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{plan.tool.title}</DialogTitle>
          <DialogDescription>{plan.tool.summary}</DialogDescription>
        </DialogHeader>

        <form
          // Native validation off: `required` here is what draws the asterisk
          // and what assistive tech announces, and leaving the browser to police
          // it would pop "Please fill out this field" in front of the sentence
          // the schema wrote for that exact field.
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
          className="space-y-3"
        >
          {plan.fields.map((field) => (
            <GeneratedField
              key={field.key}
              plan={field}
              value={values[field.key] ?? ''}
              {...(errorFor(field.key) === undefined ? {} : { error: errorFor(field.key) })}
              onChange={(next) => set(field.key, next)}
              options={field.nodeType ? (optionsByType.get(field.nodeType) ?? []) : []}
            />
          ))}

          {general.length > 0 ? (
            <p role="alert" className="text-xs text-danger">
              {general.map((p) => p.message).join(' ')}
            </p>
          ) : null}

          {plan.omitted.length > 0 ? (
            /* Said out loud rather than left to be discovered: a quick create
               that dropped keywords without a word would look like one that had
               lost them. */
            <p className="text-xs text-text-3">
              Not on this form: {plan.omitted.join(', ')}. Open the record to set{' '}
              {plan.omitted.length === 1 ? 'it' : 'them'}.
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant={plan.tool.effect === 'delete' ? 'destructive' : 'default'}
            >
              {plan.tool.title}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
