import { useEffect, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { isTypingTarget } from '@/components/common/typing-target'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useCreateActions, useRunCreateAction } from '@/lib/create-actions'

/**
 * The global create affordance.
 *
 * Creating something is the most frequent thing anyone does here, and until
 * now every route hid its own version of it — so adding a reminder meant first
 * navigating to the page that owned reminders. This sits in the chrome so the
 * answer to "add" is the same everywhere.
 *
 * Filled rather than outlined on purpose: it is the one action in a strip that
 * is otherwise navigation and filters, and it should not read as a sixth
 * icon button.
 */
export function NewMenu({ className }: { className?: string }) {
  const run = useRunCreateAction()
  const actions = useCreateActions()
  const { open, setOpen } = useNewShortcut()

  const triggerRef = useRef<HTMLButtonElement>(null)
  /** Set only while a row is handing the popover off — see the two notes below. */
  const handedOff = useRef(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          ref={triggerRef}
          type="button"
          aria-label="New"
          // Squares off below `sm`, where the topbar already wraps the search
          // field onto its own row and the top row has no width to spare.
          // `size-8` rather than `h-8 w-8`: they draw identically, and only the
          // first is reached by the coarse-pointer catch-area rule in
          // `index.css`. `PopoverTrigger asChild` also overwrites this button's
          // `data-slot` with `popover-trigger`, so the rule's other branch
          // cannot see it either — which left the New button at 32×32 under a
          // finger while every menu button it opens was 44.
          className={cn('size-8 shrink-0 rounded-md p-0 text-xs sm:w-auto sm:px-2.5', className)}
        >
          <Plus className="size-3.5" strokeWidth={2} aria-hidden />
          <span className="hidden sm:inline">New</span>
        </Button>
      </PopoverTrigger>

      <PopoverContent
        align="end"
        className="w-64 p-0"
        onCloseAutoFocus={(event) => {
          // The popover restores focus to its trigger on a `setTimeout(0)`,
          // which lands AFTER the dialog a row just opened has focused its first
          // field. Left alone that restore is the last write to focus: the modal
          // is up, focus is on the topbar behind it, and the trap has nothing to
          // trap — eight Tabs walked the aria-hidden page underneath, four of
          // them on nameless stops. The row below has already put focus where it
          // belongs, so this one is suppressed.
          //
          // Only for the handoff: Escape and a click outside still get the
          // trigger back, which is the whole point of a restore.
          if (!handedOff.current) return
          handedOff.current = false
          event.preventDefault()
        }}
      >
        {/* cmdk hangs its arrow-key and Enter handling off the input's keydown.
            Drop the input and Radix focuses the popover instead — a parent of
            the Command root, so nothing bubbles into it and the list becomes
            unreachable from the keyboard while still looking navigable. */}
        <Command>
          <CommandInput placeholder="Find something to add…" className="h-9" />
          <CommandList>
            <CommandEmpty>Nothing to add matches that.</CommandEmpty>
            <CommandGroup>
              {actions.map((action) => (
                <CommandItem
                  key={action.id}
                  value={`${action.label} ${action.hint ?? ''}`}
                  onSelect={() => {
                    // Close first: the dialog is modal, and a popover left open
                    // behind it keeps a second focus trap alive underneath.
                    setOpen(false)
                    // Then move focus to the trigger before the action runs,
                    // while this row is still on screen. It is the control the
                    // user pressed, so it is where a closing dialog should
                    // return them — and unlike this row, which is torn out of
                    // the document in the same commit, it will still be there to
                    // return to. Without it the dialog inherits a dead node and
                    // closing drops the user on <body>.
                    handedOff.current = true
                    triggerRef.current?.focus()
                    run(action)
                  }}
                  className="gap-2.5"
                >
                  <action.icon
                    className="size-4 shrink-0 text-text-3"
                    strokeWidth={1.7}
                    aria-hidden
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{action.label}</span>
                    {action.hint ? (
                      <span className="block truncate text-xs text-text-3">{action.hint}</span>
                    ) : null}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Opens the create menu on a bare `n`.
 *
 * A single unmodified letter is a hostile shortcut unless it checks where the
 * keystroke was headed: without the guards below, typing "engineer" in the
 * search box opens a dialog on the "n". So it bails on any field that takes
 * text, on an IME still assembling a character, and on an open dialog — where
 * focus is trapped and the menu would mount behind the modal, unreachable.
 *
 * `NewMenu` calls this itself, and is the only thing that can: the hook is no
 * longer exported. It was, and the note here warned against a second caller —
 * two listeners driving two states, with the key opening whichever menu mounted
 * last. Un-exporting it made that unrepresentable, which is the better fix, so
 * the warning is kept only as the reason not to export it again.
 */
function useNewShortcut() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'n') return
      // ⌘N and Ctrl-N belong to the browser; Alt-N reaches its menus.
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.isComposing || e.defaultPrevented) return
      if (isTypingTarget(e.target)) return
      // Radix unmounts dialog content on close, so a hit means one is open.
      if (document.querySelector('[data-slot="dialog-content"]')) return
      e.preventDefault()
      setOpen(true)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  return { open, setOpen }
}
