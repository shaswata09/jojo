/**
 * The day an application went out — one answer, for every reader. L1 core.
 *
 * Two fields can carry it. `submittedOn` is the Submitted stage's date: the
 * stage move writes it, and the Stage dates panel is where a person CORRECTS it
 * (`stage-dates.ts` keeps `submitted` there, not in `stageDates`). `appliedOn`
 * is fill-once — the first submission stamps it and nothing after rewrites it
 * (`stage-policy.ts`), and no screen edits it.
 *
 * So `submittedOn` wins. A date somebody typed into the panel to fix the record
 * has to be the one the charts and the agent read back; preferring the
 * fill-once copy meant the correction changed the panel and nothing else.
 * `appliedOn` remains the fallback for records that only carry that one (rows
 * created before stage moves wrote `submittedOn`).
 *
 * This used to be spelled inline at five sites in two orders — the statistics
 * read `appliedOn` first and the agent read `submittedOn` first — so one record
 * could be "sent 3 Sept" on the chart and "sent 10 Sept" in a reply.
 */
export function sentOn(a: { appliedOn?: string; submittedOn?: string }): string | undefined {
  return a.submittedOn ?? a.appliedOn
}
