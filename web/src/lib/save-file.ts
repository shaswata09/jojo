/**
 * Hands bytes to the browser as a download.
 *
 * Throws when the browser refuses — `createObjectURL` does on an exhausted
 * blob store — so the caller can say so instead of claiming a file that never
 * started. The URL is revoked on the next task, not synchronously and not in a
 * `finally`: a synchronous revoke races the download the click just started,
 * and the file arrives empty. `vault-blobs.ts` learned that first, and
 * `backup.ts` and `calendar-export.ts` keep their own copies of the same rule.
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
  const url = href
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
