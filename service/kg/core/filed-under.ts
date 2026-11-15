/**
 * L1 — what is filed under one application, by membership.
 *
 * A link, a document, a snippet, a person or a timeline item can each carry
 * several application tags, so "filed under this job" is `includes`, never a
 * comparison against the first id. Both `useVault().forApplication` and
 * `useTimeline().forApplication` read through this — which is what the
 * application page's Filed panel and its timeline list show — so the rule is
 * one function with a test rather than five inline filters.
 */
export function filedUnder<T extends { readonly applicationIds: readonly string[] }>(
  rows: readonly T[],
  appId: string,
): T[] {
  return rows.filter((row) => row.applicationIds.includes(appId))
}
