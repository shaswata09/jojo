import type { ReactNode } from 'react'
import { BootSkeleton } from '@/components/common/BootSkeleton'
import { StoreRecovery } from '@/components/common/StoreRecovery'
import { useBoot } from '@/lib/boot-context'

/**
 * The boot invariant, in one place: no graph, no app.
 *
 * `phase !== 'ready'` must mean that no consumer of the graph is mounted, and
 * one gate is what makes that structural rather than a rule thirty components
 * have to remember. It matters because an empty array in this codebase is not a
 * neutral value: `ApplicationDetail.tsx` renders "This application no longer
 * exists" for one, and Settings reads "Empty" and offers to load demo data over
 * records that are on disk and merely not read yet.
 *
 * It sits inside `StoreProvider` rather than around `<Outlet/>` in `AppShell`,
 * which is where §3.5 draws it. Two things moved it up. The gate has to be able
 * to render the corrupt arm, and that arm deliberately has no repository — so a
 * gate mounted inside the store's providers could not exist in the state it
 * exists for. And `AppShell` is a route element: reaching it means the router,
 * the sidebar and the spotlight are already mounted, and all three read the
 * graph. Placing it here means the whole app below is the thing being gated,
 * which is the invariant as written.
 *
 * `unavailable` renders the app. That is the one arm where this file disagrees
 * with §3.5's sketch, and it is the disagreement §5 asks for: a private-browsing
 * window "shows an honest banner and still runs". The banner is `StorageBanner`,
 * mounted in `AppShell`, and it is persistent rather than a toast because the
 * condition does not go away.
 */
export function StoreGate({ children }: { children: ReactNode }) {
  const { state } = useBoot()

  switch (state.phase) {
    case 'loading':
      return <BootSkeleton />
    case 'corrupt':
      return <StoreRecovery detail={state.detail} rescued={state.rescued} />
    case 'unavailable':
    case 'ready':
      return <>{children}</>
  }
}
