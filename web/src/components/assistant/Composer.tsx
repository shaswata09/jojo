import type { FormEvent, KeyboardEvent } from 'react'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { fromReactKey, shouldSend } from '@/lib/composer-keys'
import { cn } from '@/lib/utils'

/**
 * The box a question is typed into, and Send — or Stop while a run is going.
 *
 * Shared by the Assistant page and the chat dock's windows. Enter sends and
 * Shift+Enter is left to the textarea; `shouldSend` also refuses an Enter an
 * input method is using to pick a candidate (see `lib/composer-keys.ts`).
 *
 * A FIXED box: no drag handle and no growing as you type — `resize-none`
 * removes the grip, `field-sizing-fixed` cancels the primitive's
 * content-sizing, and a long message scrolls inside the box rather than
 * pushing the conversation up.
 */
export function Composer({
  id,
  label,
  value,
  onChange,
  onSend,
  busy,
  onStop,
  placeholder,
  disabled = false,
  compact = false,
}: {
  id: string
  /** The field's spoken name; the box itself shows only the placeholder. */
  label: string
  value: string
  onChange: (next: string) => void
  /** A trimmed, non-empty question. The composer clears itself first. */
  onSend: (text: string) => void
  busy: boolean
  onStop: () => void
  placeholder: string
  disabled?: boolean
  compact?: boolean
}) {
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const clean = value.trim()
    if (!clean || busy || disabled) return
    onChange('')
    onSend(clean)
  }

  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!shouldSend(fromReactKey(event))) return
    event.preventDefault()
    submit(event)
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <div className="min-w-0 flex-1">
        <Label htmlFor={id} className="sr-only">
          {label}
        </Label>
        <Textarea
          id={id}
          value={value}
          rows={2}
          className={cn(
            'field-sizing-fixed resize-none overflow-y-auto',
            compact ? 'h-14 text-[13px]' : 'h-16',
          )}
          autoComplete="off"
          disabled={busy || disabled}
          placeholder={placeholder}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKey}
        />
      </div>
      {busy ? (
        // Stop rather than a disabled send: a run that has gone wrong is
        // exactly when a person most needs a control, and the loop checks the
        // flag between every round.
        <Button
          type="button"
          variant="outline"
          size={compact ? 'sm' : 'default'}
          onClick={onStop}
          title="Stop the agent"
        >
          Stop
        </Button>
      ) : (
        <Button
          type="submit"
          size="icon"
          aria-label="Send"
          disabled={!value.trim() || disabled}
          title={value.trim() ? 'Send' : 'Type a message first'}
        >
          <ArrowUp className="size-4" strokeWidth={2} aria-hidden />
        </Button>
      )}
    </form>
  )
}
