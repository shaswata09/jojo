import { MenuSheet } from '@/components/ui/Menu'
import { displayName } from '@jojo/service/data/seed'
import { useApplications } from '@/lib/store-context'

/**
 * Files a record under a job, or under nothing.
 *
 * The list plus the "Not linked" row that clears it, in one place, because two
 * surfaces open it: the document editor's field, and the file row's own menu
 * action. Those were separate sheets built from the same array, and the one in
 * the menu was written second — which is exactly how the two come to disagree
 * about whether clearing is offered at all.
 *
 * `Not linked` sits first and is only offered when there is something to clear.
 * Listing it against a record that is already unfiled would be a row that reads
 * as an option and does nothing.
 */
export function ApplicationPickerSheet({
  open,
  value,
  onClose,
  onChange,
  title = 'Related application',
}: {
  open: boolean
  value?: string
  onClose: () => void
  /** `undefined` unfiles it. */
  onChange: (id: string | undefined) => void
  title?: string
}) {
  const { all } = useApplications()

  return (
    <MenuSheet
      open={open}
      onClose={onClose}
      title={title}
      description="One job per document. Filing it under another moves it; it is never in two places."
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
          : [
              ...(value
                ? [
                    {
                      id: 'clear',
                      label: 'Not linked',
                      icon: 'x' as const,
                      hint: 'Keep the document, drop the job it points at',
                      onPress: () => onChange(undefined),
                    },
                  ]
                : []),
              ...all.map((a) => ({
                id: a.id,
                label: displayName(a),
                hint: a.roleTag,
                checked: a.id === value,
                onPress: () => onChange(a.id),
              })),
            ]
      }
    />
  )
}
