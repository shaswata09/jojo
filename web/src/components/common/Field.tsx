import { useId } from 'react'
import type { ComponentProps, ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

/**
 * Labelled text field. `useId` ties label to input so clicking the label
 * focuses it — the audit found several inputs labelled by proximity only.
 */
export function Field({
  label,
  hint,
  mono,
  className,
  id,
  ...props
}: Omit<ComponentProps<typeof Input>, 'id'> & {
  label: string
  hint?: ReactNode
  /** Monospace for machine values — endpoints, paths, tokens. */
  mono?: boolean
  id?: string
}) {
  const generated = useId()
  const fieldId = id ?? generated

  return (
    <div className={cn('space-y-1.5', className)}>
      <Label htmlFor={fieldId} className="text-xs font-normal text-text-2">
        {label}
      </Label>
      <Input id={fieldId} className={cn(mono && 'font-mono text-xs')} {...props} />
      {hint ? <p className="text-xs text-text-3">{hint}</p> : null}
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
