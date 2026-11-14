import { Button } from '@/components/ui/button'

/**
 * The openers under an empty conversation, one button per prompt. Both
 * Assistant panels draw them the same way and only while the thread is empty.
 */
export function OpenerList({
  openers,
  disabled,
  onPick,
}: {
  /** `key` is the React key; `label` is both what the button says and what it sends. */
  openers: readonly { key: string; label: string }[]
  disabled?: boolean
  onPick: (label: string) => void
}) {
  return (
    <ul className="mt-3 flex flex-wrap gap-1.5">
      {openers.map((o) => (
        <li key={o.key}>
          <Button
            variant="outline"
            size="sm"
            disabled={disabled}
            onClick={() => {
              onPick(o.label)
            }}
          >
            {o.label}
          </Button>
        </li>
      ))}
    </ul>
  )
}
