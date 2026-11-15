import { isJobPostingUrl, onOneOf, parseSources } from '@jojo/service/core/board'
import { canonicalPostingUrl } from '@jojo/service/core/capture'
import type { Pipeline, Proposal } from '@jojo/service/core/model'
import { postingPreview, scoutReading } from '@jojo/service/core/proposal'
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
    // The keys copied first, so deleting from the map cannot disturb the walk.
    for (const id of Array.from(finished.keys())) if (!live(id)) finished.delete(id)
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
 *
 * AND ONLY A POSTING. The board's host alone let in every page the person is
 * signed in to there: with LinkedIn watched, `linkedin.com/messaging/` and
 * `/psettings/email` were opened, read and sent to the model (round 3). So the
 * address must have a posting's shape (`isJobPostingUrl`, which `board.search`
 * itself requires of every row), judged as it will be OPENED: `readPosting`
 * opens the canonical address, and that is the page that is read. A LinkedIn
 * address carrying `?currentJobId=` is opened as that job whatever its path
 * says; `canonicalPostingUrl` only ever moves an address onto a board's own
 * posting shape, never onto this machine, so the local check before it holds.
 */
export function autoReadable(
  url: string,
  pipeline: Pick<Pipeline, 'id' | 'source'>,
  listed: (pipelineId: string, url: string) => boolean,
): boolean {
  if (isLocalTarget(url)) return false
  const opened = canonicalPostingUrl(url)
  if (!isJobPostingUrl(opened)) return false
  if (listed(pipeline.id, url)) return true
  return onOneOf(opened, parseSources(pipeline.source))
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

/*
 * WHICH SUGGESTION KEPT A PAGE, written on the page itself.
 *
 * A read keeps the page before it asks the model, and says it did on the
 * card's reading — which lands only once the model has answered. A reload in
 * between lost that: the next pass found the page already kept, reused it, and
 * its reading said "not created", so Discard left a page nobody wanted in the
 * Vault for good (round 3). So the page carries the claim, in its note, from
 * the moment it is kept.
 *
 * The note, because it is the one free-text field a file record has, and it is
 * honest there: the person reading their Vault sees why the page is in it. A
 * person who edits the note has made the page theirs, and the marker goes with
 * the edit — which is the right way for that to fail. A page kept before this
 * marker existed has none and is never taken out on inference.
 */
const KEPT_FOR = /(?:^| · )Kept while reading a scout suggestion \(([^()\s]+)\)$/

/** A kept page's note, with the line that says which suggestion's read kept it. */
export function scoutKeptNote(note: string | undefined, proposalId: string): string {
  const line = `Kept while reading a scout suggestion (${proposalId})`
  const base = (note ?? '').replace(KEPT_FOR, '').trim()
  return base === '' ? line : `${base} · ${line}`
}

/** The suggestion a page's note says its read kept it for, or undefined. */
export function scoutKeptFor(note: string | undefined): string | undefined {
  return note === undefined ? undefined : KEPT_FOR.exec(note.trim())?.[1]
}

/**
 * The pages a discarded card may take back out of the Vault.
 *
 * Only a page the card's own read KEPT: the one its reading says it created,
 * and any whose note says it was kept for this card (`scoutKeptNote`). A read
 * reuses a page already kept for the address — often the person's own clip of
 * it — and Discard used to delete that too (R9). `page` is a page a finished
 * read created but could not store on the card, because the card was answered
 * while it ran.
 *
 * Whether something ELSE claims a page — an application, a saved posting,
 * another card's reading — is `otherClaimant` and the caller's to ask.
 */
export function discardablePages(
  proposalId: string,
  reading: ScoutReading | null,
  files: readonly { id: string; note?: string | undefined }[],
  page?: string,
): string[] {
  const out = new Set<string>()
  if (page !== undefined) out.add(page)
  if (reading?.created === true && reading.fileId !== undefined) out.add(reading.fileId)
  for (const file of files) if (scoutKeptFor(file.note) === proposalId) out.add(file.id)
  return [...out]
}

/**
 * Whether a card other than this one still points at the page — a reading on a
 * card nobody has discarded. Two pipelines can suggest the same posting, and
 * the second's read reuses the first's page; discarding the first must not take
 * the second's page with it.
 */
export function otherClaimant(
  proposals: readonly Pick<Proposal, 'id' | 'status' | 'reading'>[],
  proposalId: string,
  fileId: string,
): boolean {
  return proposals.some(
    (p) =>
      p.id !== proposalId && p.status !== 'discarded' && scoutReading(p.reading)?.fileId === fileId,
  )
}
