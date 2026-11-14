import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { postingIdentity } from '@jojo/service/core/capture'
import type { NodeId } from '@jojo/service/core/model'
import { postingPreview, scoutReading } from '@jojo/service/core/proposal'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { usePipelinesState } from '@jojo/service/react/pipelines-context'
import { listedByBoard } from '@jojo/service/react/use-pipelines'
import { useKg } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import { useVault } from '@jojo/service/react/use-vault'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { unshout } from '@/lib/fill-from-posting'
import { isConfigured } from '@/lib/llm'
import { useLabels } from '@/lib/labels-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { NOTHING_TO_READ_WITH, useReadPosting } from '@/lib/posting-agent'
import { discardablePage, nextToRead, readingQueue } from '@/lib/scout-reading-queue'

/**
 * Reads each posting the scout suggests, before anyone decides on it.
 *
 * Reported 2026-11-11: a suggestion is what a board's listing says — a title, a
 * link, a line the scout wrote — and the person was asked to approve or discard
 * on that. So each pending posting suggestion is opened here, in the
 * background, the way approving opens one (`useReadPosting`): the page kept in
 * the Vault, and the employer, role, place and the person's own keywords read
 * off it and put on the card (`pipeline.proposal.reading.set`). Approving then
 * uses this reading rather than opening the page a second time.
 *
 * ONE AT A TIME. Each read is a background tab and a model call; a round of
 * twelve suggestions read at once would be twelve tabs and twelve requests
 * queued on one server, and the person's own chat behind them. The lock is
 * module-level (`readingQueue`), not React state — see its header.
 *
 * ONLY ADDRESSES A BOARD GAVE. The tab is the person's signed-in browser, so
 * the reader opens only what a board read listed or what is on a board the
 * pipeline watches, and never this machine or the person's network
 * (`autoReadable`). Anything else waits for Approve. Nothing is read for a
 * pipeline that is paused or gone, and a read in flight is stopped when its
 * pipeline is paused, the settings change, or the reader unmounts.
 *
 * ONLY WHERE A READ CAN HAPPEN. Without a model there is nothing to ask, and
 * without the extension or the document reader there is nothing to open a page
 * with — and a card saying so twelve times over would be noise. The first read
 * that finds no way to open a page stops the queue until the settings change.
 *
 * A READ IS TRIED ONCE. A failure is stored too, with its sentence, so the card
 * can say why and the queue does not open the same page on every visit.
 * Approving still reads the page itself when the stored read failed. A read
 * that found nothing to open a page with, or was stopped, is not a failure of
 * that card, and is tried again.
 */

/** The read of this suggestion, running or finished, for an approval to use instead of reading again. */
export function takeReading(proposalId: string): Promise<ScoutReading | null> | undefined {
  return readingQueue.take(proposalId)
}

/** Whether this suggestion's page is being read right now — for the card's "Reading…". */
export function useReadingNow(proposalId: string): boolean {
  return useSyncExternalStore(
    readingQueue.subscribe,
    () => readingQueue.reading(proposalId),
    () => false,
  )
}

/**
 * Takes a page out of the Vault unless something else claims it — filed under
 * an application, or its address saved as a posting some other way — because
 * then it is not only this card's.
 */
function useDropUnclaimedPage(): (fileId: string, url: string | undefined) => void {
  const { repo, projections } = useKg()
  const { removeFile } = useVault()
  const blobs = useVaultBlobs()
  return useCallback(
    (fileId: string, url: string | undefined) => {
      const graph = repo.getSnapshot()
      if (graph.node(fileId as NodeId, 'file') === undefined) return
      if (graph.many(fileId as NodeId, 'FILED_UNDER', 'out', 'application').length > 0) return
      const key = url ? (postingIdentity(url) ?? url) : undefined
      const saved = projections
        .postings(graph)
        .some((p) => (postingIdentity(p.url) ?? p.url) === key)
      if (saved) return
      if (removeFile(fileId).ok) void blobs.remove(fileId)
    },
    [repo, projections, removeFile, blobs],
  )
}

/**
 * Takes a discarded suggestion's page back out of the Vault.
 *
 * The page was kept so the card could be read and approval could be instant;
 * a job the person turned down is not one they want a 7 MB copy of. Only a
 * page this card's read created (`discardablePage`): one it reused may be the
 * person's own clip of the address. Left alone, too, when anything else claims
 * it (`useDropUnclaimedPage`).
 */
export function useDropDiscardedPage(): (proposalId: string, page?: string) => void {
  const { repo, projections } = useKg()
  const dropUnclaimed = useDropUnclaimedPage()
  return useCallback(
    (proposalId: string, page?: string) => {
      const proposal = projections.proposals(repo.getSnapshot()).find((p) => p.id === proposalId)
      if (proposal?.status !== 'discarded') return
      // Passed in when the read finished after the discard, and so could not be stored.
      const fileId = discardablePage(scoutReading(proposal.reading), page)
      if (fileId === null) return
      dropUnclaimed(fileId, postingPreview(proposal.tool, proposal.input)?.href ?? undefined)
    },
    [repo, projections, dropUnclaimed],
  )
}

/** The read in flight, so it can be stopped. One at a time, so one slot. */
let current: { id: string; pipelineId: string; stop: AbortController } | null = null

function stopCurrent(): void {
  current?.stop.abort()
}

/** Mounted once, inside `PipelinesProvider`. Renders nothing. */
export function ScoutReader(): null {
  const { proposals, pipelines } = usePipelinesState()
  const { settings, reader } = useModelSettings()
  const readPosting = useReadPosting()
  const run = useRun()
  const { labels } = useLabels()
  const dropDiscarded = useDropDiscardedPage()
  const dropUnclaimed = useDropUnclaimedPage()
  /** Tried this session, so a refused write does not loop on the same card. */
  const tried = useRef(new Set<string>())
  /** Set when there was nothing to open a page with; cleared when the settings change. */
  const [blocked, setBlocked] = useState(false)
  // Re-runs the effect below when a read ends, wherever it was started.
  const epoch = useSyncExternalStore(readingQueue.subscribe, readingQueue.epoch, () => 0)
  const configured = isConfigured(settings)

  // New settings unblock the queue, and stop a read started with the old ones.
  // The cleanup is also the unmount's.
  useEffect(() => {
    setBlocked(false)
    return stopCurrent
  }, [reader, settings])

  // A read for a pipeline that was paused or deleted is stopped.
  useEffect(() => {
    if (current === null) return
    const { pipelineId } = current
    if (!pipelines.some((p) => p.id === pipelineId && p.enabled)) stopCurrent()
  }, [pipelines])

  // Finished readings are let go once their card has left the queue.
  useEffect(() => {
    readingQueue.settle((id) => proposals.some((p) => p.id === id && p.swept !== true))
  }, [proposals])

  useEffect(() => {
    if (readingQueue.busy() || blocked || !configured) return
    const next = nextToRead(proposals, pipelines, tried.current, listedByBoard)
    if (next === null) return
    const { proposal, url, pipelineId } = next
    tried.current.add(proposal.id)
    const stop = new AbortController()
    const mine = { id: proposal.id, pipelineId, stop }
    current = mine

    const read = (async (): Promise<ScoutReading | null> => {
      const out = await readPosting({ url, settings, reader, signal: stop.signal })
      const readAt = new Date().toISOString()
      if (!out.ok && stop.signal.aborted) {
        // Stopped, not failed: nothing is stored, the card is tried again
        // when it may be, and a page this read kept goes again.
        tried.current.delete(proposal.id)
        if (out.file && out.created === true) dropUnclaimed(out.file.id, url)
        return null
      }
      if (!out.ok && out.reason === NOTHING_TO_READ_WITH) {
        // Not this card's fault: it is read once something can open a page.
        tried.current.delete(proposal.id)
        setBlocked(true)
        return null
      }
      const names = new Map(labels.map((l) => [l.id, l.name]))
      const created = out.created === true ? { created: true as const } : {}
      const reading: ScoutReading = out.ok
        ? {
            ok: true,
            fields: {
              // Boards set these in capitals for display; the draft gets them
              // in ordinary case, and so does the card.
              ...(out.draft.org ? { org: unshout(out.draft.org) } : {}),
              ...(out.draft.role ? { role: out.draft.role } : {}),
              ...(out.draft.roleTag ? { roleTag: out.draft.roleTag } : {}),
              ...(out.draft.location ? { location: unshout(out.draft.location) } : {}),
              ...(out.draft.comp ? { comp: out.draft.comp } : {}),
              ...(out.draft.postingId ? { postingId: out.draft.postingId } : {}),
              ...(out.draft.deadline ? { deadline: out.draft.deadline } : {}),
              ...(out.draft.source ? { source: out.draft.source } : {}),
            },
            keywords: out.keywords.flatMap((id) => {
              const name = names.get(id)
              return name ? [{ id, name }] : []
            }),
            missing: [...out.missing],
            fileId: out.file.id,
            ...created,
            via: out.via,
            readAt,
          }
        : {
            ok: false,
            reason: out.reason,
            readAt,
            ...(out.file ? { fileId: out.file.id, ...created } : {}),
          }
      // Refused when the card was answered while its page was being read — the
      // approval then takes this reading from `takeReading` instead.
      const stored = run('pipeline.proposal.reading.set', {
        id: proposal.id,
        reading: JSON.stringify(reading),
      })
      // Discarded while its page was being read: a page this read kept goes
      // again, the way it would have had the discard come after.
      if (!stored.ok && reading.fileId && reading.created) dropDiscarded(proposal.id, reading.fileId)
      return reading
    })().finally(() => {
      if (current === mine) current = null
    })
    readingQueue.start(proposal.id, read)
  }, [
    proposals,
    pipelines,
    epoch,
    blocked,
    configured,
    settings,
    reader,
    readPosting,
    run,
    labels,
    dropDiscarded,
    dropUnclaimed,
  ])

  return null
}
