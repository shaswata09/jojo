import { draftFromUrl } from '@/components/applications/draft-from'
import type { DialogName } from '@/lib/dialogs-context'

/**
 * What pressing `AddByUrl`'s button opens, for the text in its field.
 *
 * Lifted out of the component so a test can hold it (D20: no mounting). With a
 * model connected the posting is READ — the "From link" dialog, started on this
 * URL. Without one the URL becomes a guess handed to the create form. Nothing
 * is saved either way; `AddByUrl.tsx` says why. `null` for an empty field.
 */
export function addByUrlDialog(
  typed: string,
  connected: boolean,
): { name: DialogName; props: Record<string, unknown> } | null {
  const text = typed.trim()
  if (!text) return null
  return connected
    ? { name: 'applicationFromLink', props: { url: text, start: true } }
    : { name: 'application', props: { mode: 'create', initial: draftFromUrl(text) } }
}
