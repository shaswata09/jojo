/**
 * Everything you can create, as data — and the three readers of it.
 *
 * Lifted out of `NewMenu.tsx` so the menu file exports a component and nothing
 * else. Two reasons, and the second is the one that mattered:
 *
 *  - Fast refresh. A module exporting both a component and a constant cannot be
 *    hot-replaced, so editing this array reloaded the whole app and lost
 *    whatever dialog was open.
 *  - The phone has had exactly this file since it was written —
 *    `mobile/src/lib/create-actions.ts`, same name, same shape, same two hooks.
 *    Web kept its copy inside the component, which is drift in the structure
 *    rather than in the behaviour, and the kind that quietly makes the two
 *    apps harder to read side by side.
 */

import { useCallback } from 'react'
import { useNavigate } from 'react-router'
import {
  BellRing,
  Briefcase,
  CalendarDays,
  ClipboardList,
  Link2,
  Mail,
  Sparkles,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ToolName } from '@jojo/service/tools/index'
import { useDialogs } from '@/lib/dialogs-context'
import type { DialogName } from '@/lib/dialogs-context'
import { isConfigured } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { scoutPath, vaultPath } from '@/lib/links'

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
  /**
   * A capability this row needs before it is worth offering.
   *
   * `model` means a local model is configured. The row it gates hands a page to
   * one and cannot do anything without it, and a row that opens a dialog whose
   * only message is "set a model up first" is a row that wasted the click. It
   * is hidden rather than disabled for the same reason the Vault rows navigate
   * rather than shipping dead: this menu had two dead rows once and they made
   * "New" read as half-built.
   *
   * CONFIGURED, not reachable. `SidebarRuntime` draws the difference — an
   * endpoint saved on a laptop whose server is down is configured and not
   * connected — and it probes to tell them apart. This does not: a menu row
   * that appears a second after the menu does, because a probe came back, moves
   * the row under the finger already going for it. So the row shows whenever
   * there is an address to try, and the dialog behind it reports what actually
   * happened when it tried.
   */
  requires?: 'model'
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
    id: 'new-application-from-link',
    label: 'Application from a link',
    icon: Sparkles,
    hint: 'The model reads the posting and fills the form in',
    dialog: { name: 'applicationFromLink' },
    requires: 'model',
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
 * The rows worth offering right now.
 *
 * Both surfaces that render `CREATE_ACTIONS` call this rather than the array,
 * so a gated row cannot appear in the palette and be missing from the menu —
 * which is exactly the drift the one-array note above exists to prevent, and
 * a `requires` that only one of them honoured would reintroduce it.
 */
export function useCreateActions(): CreateAction[] {
  const { settings } = useModelSettings()
  const hasModel = isConfigured(settings)
  return CREATE_ACTIONS.filter((action) => action.requires !== 'model' || hasModel)
}

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
