/**
 * L4 — the `ToolHost` an agent runs against, built from the provider.
 *
 * ## Why it is its own hook
 *
 * Two things drive jojo's tools with the same host, and until there were two
 * this was an object literal inside `use-agent.ts`. The second is the MCP link —
 * an outside client such as Claude Code, reaching the tab through `jojo-bridge`.
 * A copy of the literal there would drift from this one the first time either
 * grew a capability, and the drift would be silent: every field is optional or
 * a function, so a host missing `convert` typechecks and then tells the client
 * that no document can be read on a machine where one can.
 *
 * ## Why every field is a function
 *
 * `memory` is a getter, not a captured snapshot: an agent writes and then reads
 * within one run, and a snapshot taken when the hook rendered would describe the
 * graph as it was before its own first write. `today` is one for the same
 * reason — a conversation left open overnight, or a link left connected, must
 * not answer "is this overdue" against yesterday.
 */

import { useMemo } from 'react'
import type { ToolHost } from '../agent/execute'
import { dayOf } from '../core/project'
import type { ToolName } from '../tools/index'
import { useKg } from './kg-context'

export function useToolHost(convert?: ToolHost['convert']): ToolHost {
  const { repo, runtime, now } = useKg()
  return useMemo<ToolHost>(
    () => ({
      memory: () => repo.getSnapshot(),
      today: () => dayOf(now()),
      check: (name, input) => runtime.check(name as ToolName, input) as never,
      run: (name, input) => runtime.run(name as ToolName, input as never) as never,
      ...(convert ? { convert } : {}),
    }),
    [convert, now, repo, runtime],
  )
}
