/**
 * L4 — mounts the run registry, once, above the router.
 *
 * A provider rather than a module singleton, and the distinction is not
 * ceremony: a run holds a `ToolHost` built from the repository, and undo
 * closures over journal entries in it. When the store is reopened — an import, a
 * reset, a corrupt-store rescue — those become closures over a repository that
 * no longer exists. Owning the registry here means it is torn down and rebuilt
 * with everything else, which is the same reason `createWriteQueue` belongs to
 * `createRepository` rather than to the module that defines it.
 */

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { createAgentRuns } from './agent-runs'
import type { ErrorPort } from './agent-runs'
import { AgentRunsContext } from './agent-runs-context'

export function AgentRunsProvider({
  children,
  onError,
}: {
  children: ReactNode
  /** Where a throw under a run goes. See `ErrorPort`; absent means the console. */
  onError?: ErrorPort
}) {
  // Created once per provider instance, not per render, and not at module
  // scope. See the header.
  // `useState` with an initialiser, so the registry is built once per mount and
  // a changing `onError` identity cannot replace a run in flight.
  const [runs] = useState(() => createAgentRuns(onError))

  useEffect(
    () => () => {
      // Whatever is in flight when this unmounts is in flight against a store
      // that is going away. Stopping resolves any parked approval rather than
      // abandoning it, so nothing is left waiting on a person who has gone.
      runs.stopAll()
    },
    [runs],
  )

  return <AgentRunsContext value={runs}>{children}</AgentRunsContext>
}
