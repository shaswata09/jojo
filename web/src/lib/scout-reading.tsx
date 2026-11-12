import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { postingIdentity } from '@jojo/service/core/capture'
import type { NodeId } from '@jojo/service/core/model'
import { postingPreview, scoutReading } from '@jojo/service/core/proposal'
import type { ScoutReading } from '@jojo/service/core/proposal'
import type { Proposal } from '@jojo/service/core/model'
import { usePipelinesState } from '@jojo/service/react/pipelines-context'
import { useKg } from '@jojo/service/react/kg-context'
import { useRun } from '@jojo/service/react/use-tool'
import { useVault } from '@jojo/service/react/use-vault'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { unshout } from '@/lib/fill-from-posting'
import { isConfigured } from '@/lib/llm'
import { useLabels } from '@/lib/labels-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { NOTHING_TO_READ_WITH, useReadPosting } from '@/lib/posting-agent'

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
 * queued on one server, and the person's own chat behind them.
 *
 * ONLY WHERE A READ CAN HAPPEN. Without a model there is nothing to ask, and
 * without the extension or the document reader there is nothing to open a page
 * with — and a card saying so twelve times over would be noise. The first read
 * that finds no way to open a page stops the queue until the settings change.
 *
 * A READ IS TRIED ONCE. A failure is stored too, with its sentence, so the card
 * can say why and the queue does not open the same page on every visit.
 * Approving still reads the page itself when the stored read failed.
 */

/** Reads in flight, by proposal id — so an approval pressed mid-read waits for it. */
const inFlight = new Map<string, Promise<ScoutReading | null>>()
const listeners = new Set<() => void>()
const changed = () => {
  for (const listen of listeners) listen()
}
const subscribe = (listen: () => void) => {
  listeners.add(listen)
  return () => listeners.delete(listen)
}

/** The read of this suggestion in flight, if there is one. */
export function readingInFlight(proposalId: string): Promise<ScoutReading | null> | undefined {
  return inFlight.get(proposalId)
}

/** Whether this suggestion's page is being read right now — for the card's "Reading…". */
export function useReadingNow(proposalId: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => inFlight.has(proposalId),
    () => false,
  )
}

/** A pending posting suggestion with no reading yet, and an address a tab can open. */
function unread(p: Proposal): string | null {
  if (p.status !== 'pending' || p.tool !== 'scout.posting.save' || p.reading !== undefined) {
    return null
  }
  return postingPreview(p.tool, p.input)?.href ?? null
}

/**
 * Takes a discarded suggestion's page back out of the Vault.
 *
 * The page was kept so the card could be read and approval could be instant;
 * a job the person turned down is not one they want a 7 MB copy of. Left alone
 * when anything else claims the page — filed under an application, or the
 * address saved as a posting some other way — because then it is not only
 * this card's.
 */
export function useDropDiscardedPage(): (proposalId: string, page?: string) => void {
  const { repo, projections } = useKg()
  const { removeFile } = useVault()
  const blobs = useVaultBlobs()
  return useCallback(
    (proposalId: string, page?: string) => {
      const graph = repo.getSnapshot()
      const proposal = projections.proposals(graph).find((p) => p.id === proposalId)
      if (proposal?.status !== 'discarded') return
      // Passed in when the read finished after the discard, and so could not be stored.
      const fileId = page ?? scoutReading(proposal.reading)?.fileId
      if (fileId === undefined || graph.node(fileId as NodeId, 'file') === undefined) return
      if (graph.many(fileId as NodeId, 'FILED_UNDER', 'out', 'application').length > 0) return
      const url = postingPreview(proposal.tool, proposal.input)?.href
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

/** Mounted once, inside `PipelinesProvider`. Renders nothing. */
export function ScoutReader(): null {
  const { proposals } = usePipelinesState()
  const { settings, reader } = useModelSettings()
  const readPosting = useReadPosting()
  const run = useRun()
  const { labels } = useLabels()
  const dropDiscarded = useDropDiscardedPage()
  /** Tried this session, so a refused write does not loop on the same card. */
  const tried = useRef(new Set<string>())
  /** Set when there was nothing to open a page with; cleared when the settings change. */
  const [blocked, setBlocked] = useState(false)
  const [busy, setBusy] = useState(false)
  const configured = isConfigured(settings)

  useEffect(() => {
    setBlocked(false)
  }, [reader, settings])

  useEffect(() => {
    if (busy || blocked || !configured) return
    const next = proposals.find((p) => !tried.current.has(p.id) && unread(p) !== null)
    if (!next) return
    const url = unread(next)
    if (url === null) return
    tried.current.add(next.id)
    setBusy(true)

    const read = (async (): Promise<ScoutReading | null> => {
      const out = await readPosting({ url, settings, reader })
      const readAt = new Date().toISOString()
      if (!out.ok && out.reason === NOTHING_TO_READ_WITH) {
        setBlocked(true)
        return null
      }
      const names = new Map(labels.map((l) => [l.id, l.name]))
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
            via: out.via,
            readAt,
          }
        : { ok: false, reason: out.reason, readAt, ...(out.file ? { fileId: out.file.id } : {}) }
      // Refused when the card was answered while its page was being read — the
      // approval then takes this reading from `readingInFlight` instead.
      const stored = run('pipeline.proposal.reading.set', {
        id: next.id,
        reading: JSON.stringify(reading),
      })
      // Discarded while its page was being read: the page goes again, the way
      // it would have had the discard come after.
      if (!stored.ok && reading.fileId) dropDiscarded(next.id, reading.fileId)
      return reading
    })()
      .catch(() => null)
      .finally(() => {
        inFlight.delete(next.id)
        changed()
        setBusy(false)
      })
    inFlight.set(next.id, read)
    changed()
  }, [
    proposals,
    busy,
    blocked,
    configured,
    settings,
    reader,
    readPosting,
    run,
    labels,
    dropDiscarded,
  ])

  return null
}
