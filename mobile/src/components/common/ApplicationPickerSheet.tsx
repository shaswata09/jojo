import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { FormField } from '@/components/ui/Field'
import { MenuSheet } from '@/components/ui/Menu'
import { applicationsLabel, displayName } from '@jojo/service/data/seed'
import { useApplications } from '@/lib/store-context'

/**
 * Files a record under any number of jobs, or under none.
 *
 * The list plus the "Not linked" row that clears it, in one place, because two
 * surfaces open it: the document editor's field, and the file row's own menu
 * action. Those were separate sheets built from the same array, and the one in
 * the menu was written second — which is exactly how the two come to disagree
 * about whether clearing is offered at all.
 *
 * MULTI-SELECT, and the sheet stays up while you pick. One CV goes to every job
 * you send it to, so choosing the second should not mean reopening the sheet —
 * and a picker that dismisses on the first tap teaches people it holds one.
 * Dismissing is Done, or the backdrop. That is why the rows carry `keepOpen`
 * and this is the only `MenuSheet` in the app with a footer.
 *
 * CLEARING IS IN THE FOOTER, and that is the whole reason the footer exists.
 * It was a `Not linked` row at the top of the list, offered only when there was
 * something to clear — which was right for a single-select that closed on the
 * first tap and wrong the moment the sheet stayed open. Ticking the first job
 * inserted that row and pushed every application down by one, so a second tap
 * aimed at Rice landed on UH. Caught on the emulator, doing exactly that.
 *
 * So the footer is fixed height and always holds both buttons, and Clear is
 * disabled rather than absent when there is nothing to clear. Nothing in this
 * sheet moves in response to a tap except the ticks.
 */
export function ApplicationPickerSheet({
  open,
  values,
  onClose,
  onChange,
  title = 'Related applications',
}: {
  open: boolean
  values: readonly string[]
  onClose: () => void
  /** The whole list, every time — an empty one unfiles it. */
  onChange: (ids: string[]) => void
  title?: string
}) {
  const { all } = useApplications()

  const toggle = (id: string) => {
    onChange(values.includes(id) ? values.filter((v) => v !== id) : [...values, id])
  }

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title={title}
      description="As many jobs as it belongs to. One CV goes to every application you send it to, so this is a list, not a slot."
      footer={
        <>
          <Button
            label="Not linked"
            variant="ghost"
            disabled={values.length === 0}
            onPress={() => onChange([])}
          />
          <Button label="Done" onPress={onClose} />
        </>
      }
      actions={
        all.length === 0
          ? [
              {
                id: 'none',
                label: 'No applications yet',
                hint: 'Add one and it becomes a place to file this.',
                disabled: true,
                onPress: () => {},
              },
            ]
          : all.map((a) => ({
              id: a.id,
              label: displayName(a),
              hint: a.roleTag,
              checked: values.includes(a.id),
              keepOpen: true,
              onPress: () => toggle(a.id),
            }))
      }
    />
  )
}

/**
 * The picker as a form field, for the three editors that hold one.
 *
 * The document editor, the link editor and the snippet editor each had their
 * own label, their own trigger button, their own Clear and — in two of the
 * three — their own inline copy of the list sheet rather than the shared one
 * above. That is how the file editor came to offer clearing through a "Not
 * linked" row while the link editor offered it through a separate button, for
 * the same decision about the same edge.
 *
 * `hint` stays per-editor: what filing a document buys you and what filing a
 * link buys you are genuinely different sentences, and that was the one thing
 * the three copies had a reason to differ about.
 */
export function ApplicationField({
  values,
  onChange,
  hint,
}: {
  values: readonly string[]
  onChange: (ids: string[]) => void
  hint: string
}) {
  const { byId } = useApplications()
  const [open, setOpen] = useState(false)

  const chosen = values.map((id) => byId.get(id)).filter((a) => a !== undefined)

  return (
    <>
      {/* One control, not two. The sheet's own footer clears now, so a second
          Clear beside the trigger would be the same decision in two places —
          and it was the thing that made the field's width jump as you filled
          it in. */}
      <FormField label="Related applications" hint={hint}>
        <Button
          label={chosen.length === 0 ? 'Not linked' : applicationsLabel(chosen)}
          variant="outline"
          size="md"
          full
          onPress={() => setOpen(true)}
        />
      </FormField>

      <ApplicationPickerSheet
        open={open}
        values={values}
        onClose={() => setOpen(false)}
        onChange={onChange}
      />
    </>
  )
}
