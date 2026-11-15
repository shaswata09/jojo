/**
 * Which naming attribute the content should carry, given the trigger's id.
 *
 * Split out as a plain function because it is the whole of the decision and
 * nothing here renders in a test: a call site that states its own name must
 * win, or wiring this up would have quietly overwritten the one or two panels
 * somebody had already named by hand. In its own module so `popover.tsx`
 * exports components only, which is what lets a fast refresh keep its state.
 */
export function popoverLabelling(
  triggerId: string | null,
  stated: { ariaLabel?: string | undefined; ariaLabelledBy?: string | undefined },
): { 'aria-label'?: string; 'aria-labelledby'?: string } {
  if (stated.ariaLabel !== undefined) return { 'aria-label': stated.ariaLabel }
  if (stated.ariaLabelledBy !== undefined) return { 'aria-labelledby': stated.ariaLabelledBy }
  return triggerId === null ? {} : { 'aria-labelledby': triggerId }
}
