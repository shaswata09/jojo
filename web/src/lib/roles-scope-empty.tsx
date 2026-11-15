import { ListFilter, X } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { useRoles } from '@/lib/roles-context'

/**
 * What a chart shows when the role filter has left it nothing to count.
 *
 * Without it each panel fell through to its first-run state, "Add one and the
 * first bar appears", on a store holding dozens of applications.
 */
export function RoleScopeEmpty() {
  const { clear } = useRoles()
  return (
    <EmptyState
      icon={ListFilter}
      title="No applications for these roles"
      description="The role filter in the top bar is hiding every application this chart counts."
      action={
        <Button variant="outline" size="sm" onClick={clear}>
          <X className="size-3.5" strokeWidth={2} aria-hidden />
          Show all roles
        </Button>
      }
    />
  )
}
