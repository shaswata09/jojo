/** Small helpers several worker modules share. */

/** A sentence from whatever was thrown. */
export function reasonOf(error) {
  return error instanceof Error ? error.message : String(error)
}

export function byteLength(text) {
  return new TextEncoder().encode(text).length
}
