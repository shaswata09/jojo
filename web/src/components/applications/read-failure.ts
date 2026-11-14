/**
 * The sentence a failed "From link" read shows, given what survived it.
 *
 * A read that fails at the model step has already kept the page (`file` on the
 * outcome) — on purpose, so a refusal does not cost the person the page. Saying
 * only the reason hid that: they would open the posting again to keep it, and
 * end up with a second copy. Naming the file is what tells them not to.
 */
export function readFailureMessage(reason: string, file?: { name: string }): string {
  if (!file) return reason
  const said = /[.!?]$/.test(reason.trim()) ? reason.trim() : `${reason.trim()}.`
  return `${said} ${file.name} was saved to the Vault, so the page is not lost.`
}
