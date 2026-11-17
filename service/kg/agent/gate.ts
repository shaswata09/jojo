/**
 * What each approval mode means to the loop — in a module of its own, with
 * nothing but types for imports, so the screens that show a conversation's
 * approval mode (`react/use-agent.ts`) can read it without pulling the whole
 * agent loop into the app's first download. `perform-call.ts` re-exports it.
 *
 * A table rather than a chain of ternaries, so adding a mode is a line here and
 * a compile error everywhere it has not been handled — which is what an
 * exhaustive `Record` buys over an `if`. Tested where the loop reads it: it is
 * the whole meaning of a setting the person chooses, and `semi` mapped to
 * `none` once passed every test there was.
 */

import type { ApprovalMode } from '../core/model'
import type { GateMode } from './types'

export const GATE_FOR: { readonly [M in ApprovalMode]: GateMode } = {
  manual: 'writes',
  semi: 'destructive',
  auto: 'none',
}
