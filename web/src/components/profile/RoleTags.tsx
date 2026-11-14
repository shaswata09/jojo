import { X } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import { useApplications } from '@jojo/service/react/use-applications'
import type { ProfileFormState } from './use-profile-form'
import { ChipAdder } from './ChipAdder'
import { withAdded, without } from './profile-lists'

/** The role tags on the profile, each with how many applications carry it. */
export function RoleTags({
  roles,
  update,
}: {
  roles: readonly string[]
  update: ProfileFormState['update']
}) {
  const { all } = useApplications()

  const addRole = (typed: string) => {
    const next = withAdded(roles, typed)
    if (next) update({ roles: next })
  }

  /**
   * Removing a role does NOT rewrite the applications carrying it.
   *
   * `roleVocabulary` keeps a tag that is still in use visible in the filter and
   * the charts whether or not it is on this list, so deleting one here takes it
   * out of the picker without hiding anything you have already filed. The count
   * on the chip is what makes that legible before the press.
   */
  const removeRole = (role: string) => update({ roles: without(roles, role) })

  return (
    <div className="mt-4">
      {/* The one required field on every application, and until now a list
          of five this app chose. `useRoleVocabulary` explains why that was
          not a default so much as a limit on whose search jojo was for. */}
      <p className="mb-1 text-xs text-text-2">Role tags</p>
      <p className="mb-2 text-xs text-text-3">
        The kinds of role you are tracking. Every application is filed under one, and the role
        filter and the per-role figures in Statistics both read it. Removing one here leaves the
        applications that carry it exactly where they are.
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {roles.map((role) => {
          const used = all.filter((a) => a.roleTag === role).length
          return (
            <li key={role}>
              <Chip className="pr-1">
                {role}
                <span className="tabular ml-1 text-text-3">{used}</span>
                <button
                  type="button"
                  onClick={() => removeRole(role)}
                  aria-label={`Remove ${role}, used on ${String(used)} applications`}
                  className="ml-0.5 rounded-sm p-0.5 hover:bg-accent-border/40"
                >
                  <X className="size-3" aria-hidden />
                </button>
              </Chip>
            </li>
          )
        })}
        <li>
          <ChipAdder label="New role tag" placeholder="e.g. Data scientist" onAdd={addRole} />
        </li>
      </ul>
    </div>
  )
}
