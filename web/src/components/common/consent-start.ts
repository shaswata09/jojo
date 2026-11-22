/**
 * Where the first-run usage switch starts.
 *
 * Not `analyticsEnabled()` on its own. That reads false for a question not yet
 * asked — on purpose, so nothing is reported before the dialog is drawn — and
 * the dialog asking it IS the unasked case.
 *
 * Asked already: whatever is in force. Not asked: the shipped default, the same
 * one `crashEnabled()` falls back to for the other switch — off since
 * 2026-11-21 (Q346), so both switches start off and turning one on is the
 * person's own act. A stored "off" from
 * before the question is not a case this covers — the step is modal and comes
 * before anything that could write one.
 */
export function usageSwitchStart(enabledNow: boolean, offered: boolean, fallback: boolean): boolean {
  return offered ? enabledNow : enabledNow || fallback
}
