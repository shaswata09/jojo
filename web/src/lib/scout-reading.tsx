import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { usePipelinesState } from '@jojo/service/react/pipelines-context'
import { listedByBoard } from '@jojo/service/react/use-pipelines'
import { useRun } from '@jojo/service/react/use-tool'
import { unshout } from '@/lib/fill-from-posting'
import { isConfigured } from '@/lib/llm'
import { useLabels } from '@/lib/labels-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { NOTHING_TO_READ_WITH, NO_BACKGROUND_ROUTE, useReadPosting } from '@/lib/posting-agent'
import { useDropDiscardedPage, useDropUnclaimedPage } from '@/lib/scout-reading-hooks'
import { nextToRead, readingQueue } from '@/lib/scout-reading-queue'

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
 * the reader opens only a posting's address that a board read listed or that
 * is on a board the pipeline watches, and never this machine or the person's
 * network
 * (`autoReadable`). Anything else waits for Approve. Nothing is read for a
 * pipeline that is paused or gone, and a read in flight is stopped when its
 * pipeline is paused, the settings change, or the reader unmounts.
 *
 * ONLY WHERE A READ CAN HAPPEN. Without a model there is nothing to ask, and
 * without the extension there is nothing to open a page with — and a card
 * saying so twelve times over would be noise. The first read that finds no way
 * to open a page stops the queue until the settings change. The document reader
 * does not count here: it follows redirects without checking where they go, so
 * it is kept for postings a person opens (`unattended` in `posting-agent.ts`).
 *
 * A READ IS TRIED ONCE. A failure is stored too, with its sentence, so the card
 * can say why and the queue does not open the same page on every visit.
 * Approving still reads the page itself when the stored read failed. A read
 * that found nothing to open a page with, or was stopped, is not a failure of
 * that card, and is tried again.
 */

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
      const out = await readPosting({
        url,
        settings,
        reader,
        signal: stop.signal,
        unattended: true,
        keptFor: proposal.id,
      })
      const readAt = new Date().toISOString()
      if (!out.ok && stop.signal.aborted) {
        // Stopped, not failed: nothing is stored, the card is tried again
        // when it may be, and a page this read kept goes again.
        tried.current.delete(proposal.id)
        if (out.file && out.created === true) dropUnclaimed(out.file.id, url, proposal.id)
        return null
      }
      if (!out.ok && (out.reason === NOTHING_TO_READ_WITH || out.reason === NO_BACKGROUND_ROUTE)) {
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
      // again, the way it would have had the discard come after — the one it
      // created, and one an earlier read kept for this card before a reload.
      if (!stored.ok) dropDiscarded(proposal.id, reading.created ? reading.fileId : undefined)
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
