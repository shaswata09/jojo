/**
 * How long a download's blob URL is kept after the click.
 *
 * It used to be revoked on the next task (`setTimeout(…, 0)`). That stops the
 * synchronous-revoke race in Chrome, but Firefox resolves a blob URL for a
 * download asynchronously, and a large file — a backup above all — can still
 * be resolving when a next-task revoke lands, so it arrives empty or not at
 * all while `lastBackupAt` has already told the person they are safe. A
 * minute is generous for any download to have resolved its URL, and holding
 * the bytes that long is a small price for a file that actually arrives.
 */
export const REVOKE_AFTER_MS = 60_000

/**
 * Releases a download's blob URL once the browser has certainly taken it.
 *
 * The one copy of the rule: `backup.ts`, `calendar-export.ts`, `vault-blobs.ts`
 * and `saveFile` below each used to keep their own `setTimeout(…, 0)`.
 */
export function revokeLater(url: string, after: number = REVOKE_AFTER_MS): void {
  setTimeout(() => URL.revokeObjectURL(url), after)
}

/**
 * Hands bytes to the browser as a download.
 *
 * Throws when the browser refuses — `createObjectURL` does on an exhausted
 * blob store — so the caller can say so instead of claiming a file that never
 * started. The URL is revoked later, not synchronously and not in a `finally`:
 * a synchronous revoke races the download the click just started, and the
 * file arrives empty. See `revokeLater`.
 */
export function saveFile(data: BlobPart, name: string, type: string): void {
  let href: string | null = null
  try {
    href = URL.createObjectURL(new Blob([data], { type }))
    const anchor = document.createElement('a')
    anchor.href = href
    anchor.download = name
    anchor.click()
  } catch (error) {
    // Only on the throwing path, where no download was started to race.
    if (href !== null) URL.revokeObjectURL(href)
    throw error
  }
  revokeLater(href)
}
