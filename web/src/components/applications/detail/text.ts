/**
 * The two counting phrases the record speaks, shared because both halves of it
 * say them: the header prints "3 days ago" under the name while the delete
 * confirmation lists "2 reminders, 1 event and 4 saved items", and a second
 * copy of either would be the one that drifts.
 */

export const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

/** 'a', 'a and b', 'a, b and c'. */
export function listJoin(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
