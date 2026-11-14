import { onOneOf, parseSources } from '@jojo/service/core/board'
import type { Pipeline, Proposal } from '@jojo/service/core/model'
import { postingPreview } from '@jojo/service/core/proposal'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { isLocalTarget } from '@/lib/posting-target'

/**
 * The background reader's queue, without React — what `ScoutReader` decides
 * and remembers, kept here so it can be driven by a test.
 *
 * Module-level on purpose. The one-at-a-time rule used to rest on a `busy`
 * React state, and StrictMode runs an effect twice before either run's state
 * update lands: two reads started at once. A Map every run sees is the lock.
 */

/** Reads in flight, by proposal id — so an approval pressed mid-read waits for it. */
const inFlight = new Map<string, Promise<ScoutReading | null>>()

/**
 * Readings that finished, by proposal id, until an approval takes one or the
 * card leaves the queue.
 *
 * Approve all approves every card first and reads pages after, one card at a
 * time. A background read that finished before its card's turn could not be
 * stored on the card (it was no longer pending) and was out of `inFlight`, so
 * that card's page was opened a second time.
 */
const finished = new Map<string, ScoutReading>()

let epoch = 0
const listeners = new Set<() => void>()

function changed(): void {
  epoch += 1
  for (const listen of listeners) listen()
}

export const readingQueue = {
  subscribe(listen: () => void): () => void {
    listeners.add(listen)
    return () => {
      listeners.delete(listen)
    }
  },
  /** Bumped whenever a read starts or ends — what re-runs the reader's effect. */
  epoch: (): number => epoch,
  /** Whether a read is running anywhere on the page. One at a time. */
  busy: (): boolean => inFlight.size > 0,
  reading: (proposalId: string): boolean => inFlight.has(proposalId),

  /** Records a read as in flight until `read` settles; its result is kept for an approval. */
  start(proposalId: string, read: Promise<ScoutReading | null>): void {
    const tracked = read
      .catch(() => null)
      .then((reading) => {
        if (reading !== null) finished.set(proposalId, reading)
        return reading
      })
      .finally(() => {
        inFlight.delete(proposalId)
        changed()
      })
    inFlight.set(proposalId, tracked)
    changed()
  },

  /**
   * The reading for this card if one is running or finished, taken: an
   * approval reads the page once, and the entry is not needed after.
   */
  take(proposalId: string): Promise<ScoutReading | null> | undefined {
    const running = inFlight.get(proposalId)
    if (running) {
      return running.then((reading) => {
        finished.delete(proposalId)
        return reading
      })
    }
    const done = finished.get(proposalId)
    if (done === undefined) return undefined
    finished.delete(proposalId)
    return Promise.resolve(done)
  },

  /** Lets go of finished readings whose card has left the queue for good. */
  settle(live: (proposalId: string) => boolean): void {
    for (const id of [...finished.keys()]) if (!live(id)) finished.delete(id)
  },

  /** For tests: an empty queue. */
  reset(): void {
    inFlight.clear()
    finished.clear()
    changed()
  },
}

/** A pending posting suggestion with no reading yet, and an address a tab can open. */
export function unread(p: Proposal): string | null {
  if (p.status !== 'pending' || p.tool !== 'scout.posting.save' || p.reading !== undefined) {
    return null
  }
  return postingPreview(p.tool, p.input)?.href ?? null
}

/**
 * Whether the reader may open this address on its own, before anyone has
 * looked at the card.
 *
 * It opens a tab in the person's signed-in browser, and a suggestion's address
 * is whatever the model wrote — a listing carrying instructions could make it
 * a webmail inbox or a router's admin page (R6). So only an address one of
 * this pipeline's board reads actually listed, or one on a board the pipeline
 * watches (by host, the way `board.search` itself decides), and never one on
 * this machine or the person's network. Anything else waits for Approve, where
 * a person has seen the address first.
 */
export function autoReadable(
  url: string,
  pipeline: Pick<Pipeline, 'id' | 'source'>,
  listed: (pipelineId: string, url: string) => boolean,
): boolean {
  if (isLocalTarget(url)) return false
  if (listed(pipeline.id, url)) return true
  return onOneOf(url, parseSources(pipeline.source))
}

/**
 * The next card to read, or null.
 *
 * Skips a card already tried this session, one being read, one whose pipeline
 * is paused or gone (a paused pipeline is one the person stopped), and one
 * whose address may not be opened unattended.
 */
export function nextToRead(
  proposals: readonly Proposal[],
  pipelines: readonly Pick<Pipeline, 'id' | 'source' | 'enabled'>[],
  tried: ReadonlySet<string>,
  listed: (pipelineId: string, url: string) => boolean,
): { proposal: Proposal; url: string; pipelineId: string } | null {
  for (const proposal of proposals) {
    if (tried.has(proposal.id) || readingQueue.reading(proposal.id)) continue
    const url = unread(proposal)
    if (url === null) continue
    const pipeline = pipelines.find((p) => p.id === proposal.pipelineId)
    if (!pipeline?.enabled) continue
    if (!autoReadable(url, pipeline, listed)) continue
    return { proposal, url, pipelineId: pipeline.id }
  }
  return null
}

/**
 * The page a discarded card may take back out of the Vault, or null.
 *
 * Only a page the card's own read CREATED. A read reuses a page already kept
 * for the address — often the person's own clip of it — and Discard used to
 * delete that too (R9). `page` is a page a finished read created but could not
 * store on the card, because the card was answered while it ran.
 */
export function discardablePage(reading: ScoutReading | null, page?: string): string | null {
  if (page !== undefined) return page
  if (reading?.created !== true) return null
  return reading.fileId ?? null
}
