/** The bucket a profile document belongs to, in the Vault's own vocabulary. */
export const DOCUMENTS_BUCKET = 'Applications' as const

/**
 * The list with a typed term added, or null when there is nothing to write:
 * a blank entry, or one the list already holds. The typing is trimmed first.
 */
export function withAdded(list: readonly string[], typed: string): string[] | null {
  const term = typed.trim()
  return term && !list.includes(term) ? [...list, term] : null
}

/** The list with one entry taken out. */
export function without(list: readonly string[], term: string): string[] {
  return list.filter((x) => x !== term)
}
