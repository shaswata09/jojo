import { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

/**
 * The marker is decorative. `required` on the control is what assistive tech
 * announces, so giving the asterisk to the accessibility tree as well would
 * have every field read its obligation out twice.
 */
function FieldLabel({
  htmlFor,
  label,
  required,
}: {
  htmlFor?: string
  label: string
  required?: boolean
}) {
  return (
    <Label htmlFor={htmlFor} className="text-xs font-normal text-text-2">
      {label}
      {required ? (
        <span aria-hidden="true" className="-ml-1 text-danger">
          *
        </span>
      ) : null}
    </Label>
  )
}

function FieldMessages({
  error,
  errorId,
  hint,
  hintId,
  announce,
}: {
  error?: ReactNode
  errorId: string
  hint?: ReactNode
  hintId: string
  /** Speak the error the moment it appears — see `Field`'s `announce`. */
  announce?: boolean
}) {
  return (
    <>
      {error ? (
        <p id={errorId} role={announce ? 'alert' : undefined} className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      {hint ? (
        <p id={hintId} className="text-xs text-text-3">
          {hint}
        </p>
      ) : null}
    </>
  )
}

/** Error first: it supersedes the guidance underneath it, so it is read first. */
function describedBy(error: ReactNode, errorId: string, hint: ReactNode, hintId: string) {
  const ids = [error ? errorId : '', hint ? hintId : ''].filter(Boolean)
  return ids.length > 0 ? ids.join(' ') : undefined
}

/**
 * Labelled text field. `useId` ties label to input so clicking the label
 * focuses it — the audit found several inputs labelled by proximity only.
 */
export function Field({
  label,
  hint,
  error,
  announce,
  required,
  mono,
  className,
  id,
  ...props
}: Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string
  hint?: ReactNode
  /**
   * The problem, in words. Its presence is also what raises `aria-invalid`,
   * which is what the input's own invalid styling has been keyed to all along.
   */
  error?: ReactNode
  /**
   * Set on fields validated when the form is submitted rather than as you type.
   * `aria-describedby` is only read when the control takes focus, so an error
   * that appears after a submit — with focus still on the button, or moved to
   * the first bad field by the form — is otherwise never spoken at all. Leave
   * it off for as-you-type validation, where an alert on every keystroke talks
   * over the typing.
   */
  announce?: boolean
  required?: boolean
  /** Monospace for machine values — endpoints, paths, tokens. */
  mono?: boolean
  id?: string
}) {
  const generated = useId()
  const fieldId = id ?? generated
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`

  return (
    <div className={cn('space-y-1.5', className)}>
      <FieldLabel htmlFor={fieldId} label={label} required={required} />
      <Input
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, errorId, hint, hintId)}
        className={cn(mono && 'font-mono text-xs')}
        {...props}
      />
      <FieldMessages
        error={error}
        errorId={errorId}
        hint={hint}
        hintId={hintId}
        announce={announce}
      />
    </div>
  )
}

/** Field's counterpart for multi-line text — notes, descriptions, cover letters. */
export function TextareaField({
  label,
  hint,
  error,
  announce,
  required,
  mono,
  className,
  id,
  ...props
}: Omit<ComponentProps<typeof Textarea>, 'id'> & {
  label: string
  hint?: ReactNode
  error?: ReactNode
  /** See Field — for errors raised on submit rather than as you type. */
  announce?: boolean
  required?: boolean
  mono?: boolean
  id?: string
}) {
  const generated = useId()
  const fieldId = id ?? generated
  const hintId = `${fieldId}-hint`
  const errorId = `${fieldId}-error`

  return (
    <div className={cn('space-y-1.5', className)}>
      <FieldLabel htmlFor={fieldId} label={label} required={required} />
      <Textarea
        id={fieldId}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(error, errorId, hint, hintId)}
        className={cn(mono && 'font-mono text-xs')}
        {...props}
      />
      <FieldMessages
        error={error}
        errorId={errorId}
        hint={hint}
        hintId={hintId}
        announce={announce}
      />
    </div>
  )
}

/**
 * Label, hint and error around a control that is not an <input> — a Segment, a
 * Switch, a popover picker.
 *
 * The child is arbitrary, so unlike Field this cannot reach in and set
 * `aria-describedby` on it. The error therefore carries `role="alert"`: it gets
 * announced when it appears rather than whenever the control next takes focus,
 * which here is the difference between being read and not being read at all.
 */
export function FormField({
  label,
  hint,
  error,
  required,
  htmlFor,
  className,
  children,
}: {
  label: string
  hint?: ReactNode
  error?: ReactNode
  required?: boolean
  /**
   * Id of the control, when it takes one — a Switch, a picker's trigger button.
   * Omit for composites like Segment, which name themselves.
   */
  htmlFor?: string
  className?: string
  children: ReactNode
}) {
  const generated = useId()
  const base = htmlFor ?? generated

  return (
    <div className={cn('space-y-1.5', className)}>
      <FieldLabel htmlFor={htmlFor} label={label} required={required} />
      {children}
      <FieldMessages
        error={error}
        errorId={`${base}-error`}
        hint={hint}
        hintId={`${base}-hint`}
        announce
      />
    </div>
  )
}

/** A labelled row with a control on the right — settings and preference toggles. */
export function SettingRow({
  label,
  description,
  control,
}: {
  label: ReactNode
  description?: ReactNode
  control: ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-hairline py-3 first:border-t-0">
      <div className="min-w-0">
        <div className="text-sm text-text-1">{label}</div>
        {description ? <div className="mt-0.5 text-xs text-text-3">{description}</div> : null}
      </div>
      <div className="shrink-0 pt-0.5">{control}</div>
    </div>
  )
}
