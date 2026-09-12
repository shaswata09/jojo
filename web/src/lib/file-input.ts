/**
 * The files a person just picked, taken off the input before it is cleared.
 *
 * Clearing a file input after every pick is right: without it, choosing the
 * same document twice fires no second `change` event and the button looks
 * broken. The ORDER is the whole of this file. `input.files` is a LIVE
 * `FileList` — the same object before and after `value = ''` — and clearing
 * the input empties it. A handler that keeps the reference, clears, and then
 * reads it reads nothing. Measured in Chrome 151: `held.length` went from 1 to
 * 0 on the clear, `held === input.files` throughout.
 *
 * That is how uploading from the Profile page filed nothing, ever, on this
 * browser, while the Vault's own picker — which happened to file first and
 * clear second — worked. Reported 2026-09-12 as "my materials are uploaded and
 * the profile is not developing": the materials were never stored.
 */
export function pickedFiles(input: { files: FileList | null; value: string }): File[] {
  const picked = Array.from(input.files ?? [])
  input.value = ''
  return picked
}
