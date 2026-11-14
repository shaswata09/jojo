/**
 * The capture queue: pages the Capture button kept, waiting in
 * `chrome.storage.local` until jojo collects them.
 */

export const QUEUE = 'jojo.captures'

export async function read() {
  const stored = await chrome.storage.local.get(QUEUE)
  return Array.isArray(stored[QUEUE]) ? stored[QUEUE] : []
}

/**
 * Every read-modify-write of the queue, one at a time.
 *
 * `capture`, `delete`, `clear` and `ack` each read the whole queue, change it
 * and write it back, with awaits in between. Two at once — a capture landing
 * while jojo acknowledges the last batch — each wrote back the list it read,
 * and the second write erased the first's change: a kept page vanished, or a
 * filed one came back to be filed again. Chained here, each sees the last's
 * result. A failure does not jam the chain.
 */
let queueChain = Promise.resolve()
export function withQueue(change) {
  const run = queueChain.then(change, change)
  queueChain = run.catch(() => undefined)
  return run
}
