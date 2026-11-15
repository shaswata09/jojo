import { useCallback, useSyncExternalStore } from 'react'
import { postingIdentity } from '@jojo/service/core/capture'
import type { NodeId } from '@jojo/service/core/model'
import { postingPreview, scoutReading } from '@jojo/service/core/proposal'
import type { ScoutReading } from '@jojo/service/core/proposal'
import { useKg } from '@jojo/service/react/kg-context'
import { useVault } from '@jojo/service/react/use-vault'
import { useVaultBlobs } from '@/lib/vault-blobs'
import { discardablePages, otherClaimant, readingQueue } from '@/lib/scout-reading-queue'

/**
 * What the scout cards and the approval ask of the background reader in
 * `scout-reading.tsx`: its reading, whether it is reading now, and how a page it
 * kept is let go. Apart from that file so it exports its component only, which is
 * what lets a fast refresh keep its state.
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
 * an application, its address saved as a posting some other way, or another
 * card's reading pointing at it — because then it is not only this card's.
 */
export function useDropUnclaimedPage(): (
  fileId: string,
  url: string | undefined,
  proposalId: string,
) => void {
  const { repo, projections } = useKg()
  const { removeFile } = useVault()
  const blobs = useVaultBlobs()
  return useCallback(
    (fileId: string, url: string | undefined, proposalId: string) => {
      const graph = repo.getSnapshot()
      if (graph.node(fileId as NodeId, 'file') === undefined) return
      if (graph.many(fileId as NodeId, 'FILED_UNDER', 'out', 'application').length > 0) return
      if (otherClaimant(projections.proposals(graph), proposalId, fileId)) return
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
 * page this card's read kept (`discardablePages`): one it reused may be the
 * person's own clip of the address. Left alone, too, when anything else claims
 * it (`useDropUnclaimedPage`).
 */
export function useDropDiscardedPage(): (proposalId: string, page?: string) => void {
  const { repo, projections } = useKg()
  const dropUnclaimed = useDropUnclaimedPage()
  return useCallback(
    (proposalId: string, page?: string) => {
      const graph = repo.getSnapshot()
      const proposal = projections.proposals(graph).find((p) => p.id === proposalId)
      if (proposal?.status !== 'discarded') return
      const url = postingPreview(proposal.tool, proposal.input)?.href ?? undefined
      // `page` is passed in when the read finished after the discard, and so
      // could not be stored on the card.
      const pages = discardablePages(
        proposalId,
        scoutReading(proposal.reading),
        projections.files(graph),
        page,
      )
      for (const fileId of pages) dropUnclaimed(fileId, url, proposalId)
    },
    [repo, projections, dropUnclaimed],
  )
}
