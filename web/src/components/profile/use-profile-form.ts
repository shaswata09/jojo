import { useState } from 'react'
import type { ChangeEvent } from 'react'
import type { ProfileText } from '@/data/profile'
import { profileForm } from '@/lib/profile-draft'
import { useProfile } from '@jojo/service/react/use-profile'
import { useToast } from '@/lib/toast-context'
import { useUndoable } from '@/lib/undo'
import { announceRefusal } from '@/components/common/write-result'

/**
 * The profile's text fields, the edit over them, and Save / Discard.
 */
export function useProfileForm() {
  /**
   * The saved record lives in the store; only the typing is route state.
   *
   * The audit found the whole page held in `useState`, which meant Save wrote
   * to something react-router threw away on the next click — the field reverted
   * while the toast said it had been kept for the visit. `saved` is now the
   * store's copy, and the edit below is the only thing that dies with the
   * route, which is what an unsaved edit is supposed to do.
   *
   * The difference between the two is the whole feature: it is what makes the
   * save bar appear, what Discard restores, and what stops Save writing a
   * record identical to the one already there.
   *
   * NULL UNTIL SOMEBODY TYPES, and that part is a repair. It was
   * `useState(saved)`, whose initialiser reads its argument once — so the page
   * held a copy of the record taken at mount and this page is not the only
   * writer of it. `profile.text.set` is a non-internal tool, which means the
   * Spotlight palette offers it a form on ⌘K over `/profile` itself; measured
   * against a live store, the record went to "Dr Alex Rivera" while the field
   * still read "Alex Rivera", the sticky bar came up announcing changes nobody
   * had typed, and Save wrote the mount-time copy back over the new one. A
   * clean form is a view of the record now; see `lib/profile-draft.ts`.
   */
  const { profile, update } = useProfile()
  const saved = profile.text
  const [edit, setEdit] = useState<ProfileText | null>(null)
  const { fields: draft, dirty } = profileForm(edit, saved)
  const { toast } = useToast()
  const undoable = useUndoable()

  /*
   * Seeded from what is on screen, which is the store's copy until the first
   * keystroke. `saved` rather than `draft` inside the updater would race a
   * write landing between two keystrokes; `draft` is what the person is looking
   * at, and it is what they mean to be editing.
   */
  const set = (key: keyof ProfileText) => (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.target
    setEdit((prev) => ({ ...(prev ?? saved), [key]: value }))
  }

  /**
   * The one write on the page that had no Undo.
   *
   * It is the write that most needs one: ten fields go in behind a single
   * button. Pressing Save with nothing changed commits nothing, and `restore`
   * is `null` there rather than a button that would do nothing.
   *
   * The edit is DROPPED by the save, which is a change. It used to be left on
   * screen, and the comment here justified that by what an Undo then did — the
   * record went back while the typing stayed, leaving a save bar the user could
   * press again. That reading missed the cost: a form still holding a copy of
   * what it saved is a form that shadows the record, so the next write from
   * anywhere else (the Spotlight palette's "Edit one profile field", a restore,
   * `memory.clear`) was invisible here and the bar came up over changes nobody
   * had typed. Undoing now puts the record back on screen as well as in the
   * store, which is what Undo means everywhere else in this app.
   *
   * Dropping it is only safe because this write cannot be refused: `profile.set`
   * takes ten unconstrained strings and a refusal would have to come from the
   * schema. Anything that is not a refusal is re-thrown to the ErrorBoundary by
   * the runtime rather than swallowed, so there is no path where the save
   * quietly fails and takes what was typed with it.
   */
  const onSave = () => {
    const { value, restore } = undoable(() => update({ text: draft }))
    // Kept open with what was typed if the write was refused.
    if (announceRefusal(value, toast)) return
    setEdit(null)
    toast({
      title: 'Profile saved',
      // Was "kept for this visit — the profile is not written to disk yet",
      // which stopped being true when the store went to IndexedDB. A save toast
      // that undersells the save is the one kind of false modesty that costs
      // something: it is the sentence that sends someone off to retype it
      // somewhere they trust more.
      description: 'Written to this browser and kept.',
      action: restore ? { label: 'Undo', onClick: restore } : undefined,
    })
  }

  /** Back to the record: dropping the edit makes the form a view of the store again. */
  const discard = () => setEdit(null)

  return { profile, update, draft, dirty, set, onSave, discard }
}

export type ProfileFormState = ReturnType<typeof useProfileForm>
