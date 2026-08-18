import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { BellRing, Briefcase, CalendarDays, ClipboardList, Link2, Mail, Plus } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
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
import type { ToolName } from '@jojo/service/tools/index'
import { useDialogs } from '@/lib/dialogs-context'
import type { DialogName } from '@/lib/dialogs-context'
import { scoutPath, vaultPath } from '@/lib/links'
import { cn } from '@/lib/utils'

export type CreateAction = {
  id: string
  label: string
  icon: LucideIcon
  /**
   * A second line under the label. It says where the row goes when that is not
   * obvious — a row that opens a page rather than a dialog is a different
   * promise from the ones above it, and the hint is where that gets said.
   */
  hint?: string
  /** The dialog this row opens, with whatever it should open with. */
  dialog?: { name: DialogName; props?: Record<string, unknown> }
  /**
   * Or the page that owns this kind of record.
   *
   * Links, files, snippets and postings are all created in place — the Vault's
   * tools and the scout's capture panel each hold a real form, and lifting one
   * into a dialog would be a second editor for the same record. So these rows
   * navigate. Previously they named dialogs nobody was building and shipped
   * disabled, which made "New" a menu with two dead rows in it.
   */
  to?: string
  /**
   * The tool this row's DIALOG already runs, when it opens one.
   *
   * The command palette lists every tool that can be given a generated form, and
   * `application.create` is one of them — so without this the palette showed
   * "New application", which opens the hand-written dialog that knows about
   * keywords and offers, directly above "Add application", a generated form that
   * does not. Two rows, nearly the same words, quietly different powers. Named
   * here rather than in the palette so the pair cannot drift apart: the row and
   * the tool it supersedes are one entry.
   *
   * Only for rows that open a dialog. `save-link` navigates to the Vault, which
   * is not the same promise as running `vault.link.save`, so that tool stays in
   * the palette on its own account.
   */
  tool?: ToolName
}

/**
 * Everything you can create, in one array.
 *
 * The topbar menu and the command palette both offer these, and when each
 * owned its own copy the palette kept an item the menu had renamed and missed
 * the one it had gained. Data here, rendering in the two surfaces — they can
 * disagree about layout, never about what exists.
 *
 * Ordered by how often a tracker actually needs them, not alphabetically.
 */
export const CREATE_ACTIONS: CreateAction[] = [
  {
    id: 'new-application',
    label: 'New application',
    icon: ClipboardList,
    dialog: { name: 'application' },
    tool: 'application.create',
  },
  {
    id: 'new-reminder',
    label: 'New reminder',
    icon: BellRing,
    // Reminders and events are one record with one dialog — `mode` only picks
    // which fields lead, so the two rows cannot drift into two editors.
    dialog: { name: 'timelineItem', props: { mode: 'reminder' } },
    tool: 'timeline.item.create',
  },
  {
    id: 'new-event',
    label: 'New event',
    icon: CalendarDays,
    dialog: { name: 'timelineItem', props: { mode: 'event' } },
    tool: 'timeline.item.create',
  },
  {
    id: 'draft-message',
    label: 'Draft a message',
    icon: Mail,
    // Opened with no record, so nothing is substituted and every blank stays on
    // the page. Reachable from a reminder as well, where it can also tick it off.
    hint: 'From your email snippets — nothing is generated',
    dialog: { name: 'draft' },
  },
  {
    id: 'save-link',
    label: 'Save a link',
    icon: Link2,
    hint: 'Opens the Vault, links tool',
    to: vaultPath({ tool: 'links' }),
  },
  {
    id: 'save-posting',
    label: 'Save a posting',
    icon: Briefcase,
    hint: 'Opens Job scout',
    to: scoutPath(),
  },
]

/**
 * The tools a row above already covers with a real dialog.
 *
 * Derived rather than listed, so adding a `tool` to a row is the whole change.
 */
export const DIALOG_TOOLS: ReadonlySet<ToolName> = new Set(
  CREATE_ACTIONS.flatMap((action) => (action.dialog && action.tool ? [action.tool] : [])),
)

/**
 * Runs one of the rows above, whichever kind it is.
 *
 * Both surfaces that render `CREATE_ACTIONS` need this, and when each read the
 * shape itself the palette kept firing `run` on a row the menu had turned into
 * a link. One reader, so a new kind of action lands in both places at once.
 *
 * Safe to call from anywhere inside the router — which both call sites are.
 */
export function useRunCreateAction() {
  const { open } = useDialogs()
  const navigate = useNavigate()

  return useCallback(
    (action: CreateAction) => {
      if (action.dialog) open(action.dialog.name, action.dialog.props)
      else if (action.to) navigate(action.to)
    },
    [open, navigate],
  )
}

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
              {CREATE_ACTIONS.map((action) => (
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
