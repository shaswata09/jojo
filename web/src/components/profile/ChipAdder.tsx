import { useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

/**
 * The "Add" at the end of a chip list, which turns into a one-line form.
 *
 * Commits on Enter and hands the typing to `onAdd` as typed; the caller
 * decides whether it is worth writing (see `withAdded`).
 */
export function ChipAdder({
  label,
  placeholder,
  onAdd,
}: {
  /** The input's accessible name. */
  label: string
  placeholder: string
  onAdd: (typed: string) => void
}) {
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')

  if (!adding)
    return (
      <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
        <Plus className="size-3" strokeWidth={2} aria-hidden />
        Add
      </Button>
    )

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onAdd(draft)
        setDraft('')
        setAdding(false)
      }}
    >
      <Input
        autoFocus
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        className="h-7 w-44 text-xs"
        onChange={(event) => setDraft(event.target.value)}
        // Enter fires submit first, so blur only ever abandons a
        // term nobody finished typing.
        onBlur={() => setAdding(false)}
      />
    </form>
  )
}
