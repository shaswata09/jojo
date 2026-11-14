import { useState } from 'react'
import type { SavedPosting } from '@/data/scout'
import type { VaultFile } from '@/data/vault'
import { useGraph } from '@jojo/service/react/kg-context'
import { useVault } from '@jojo/service/react/use-vault'
import { useToast } from '@/lib/toast-context'
import { useModelSettings } from '@/lib/model-settings-context'
import { useKeepPostingPage } from '@/lib/posting-agent'
import type { KeptPage } from '@/lib/posting-agent'
import { postingIdentity } from '@jojo/service/core/capture'
import { postingSourceForUrl } from '@jojo/service/core/posting-source'

/*
 * The page behind each posting, kept the way "From link" keeps one.
 *
 * A saved posting used to be a URL and a date: the scout found the job, the
 * person approved it, and the page itself — the requirements, the deadline,
 * the thing the listing coming down takes with it — was never kept, though
 * the button to open it sat disabled on every row. See `useKeepPostingPage`.
 */
export function usePostingPages() {
  const keepPage = useKeepPostingPage()
  const { reader } = useModelSettings()
  const { toast } = useToast()
  const graph = useGraph()
  const { files } = useVault()
  /** Postings whose page is being kept right now, by identity. */
  const [keeping, setKeeping] = useState<ReadonlySet<string>>(() => new Set())
  const keyOf = (postingUrl: string) => postingIdentity(postingUrl) ?? postingUrl

  const pageFor = (posting: SavedPosting): VaultFile | null => {
    const source = postingSourceForUrl(graph, posting.url)
    return source ? (files.find((f) => f.id === source.fileId) ?? null) : null
  }

  /** Marks the posting's page as being worked on for as long as `work` runs. */
  const whileKeeping = async <T>(postingUrl: string, work: () => Promise<T>): Promise<T> => {
    const key = keyOf(postingUrl)
    setKeeping((now) => new Set(now).add(key))
    try {
      return await work()
    } finally {
      setKeeping((now) => {
        const next = new Set(now)
        next.delete(key)
        return next
      })
    }
  }

  /** Says how keeping one page went. Quiet when it was already in the Vault. */
  const reportKept = (kept: KeptPage, title: string) => {
    if (!kept.ok) {
      toast({ title: 'The posting’s page was not saved', description: kept.reason, tone: 'danger' })
      return
    }
    if (kept.via === 'already') return
    toast({
      title: 'Posting page saved',
      description: kept.filedUnder
        ? `${title} — filed under its application.`
        : `${title} — in the Vault under Job postings.`,
    })
  }

  const keepPostingPage = (postingUrl: string, title: string): Promise<KeptPage> =>
    whileKeeping(postingUrl, () => keepPage({ url: postingUrl, title, reader }))

  const keepAndReport = (postingUrl: string, title: string) =>
    void keepPostingPage(postingUrl, title).then((kept) => reportKept(kept, title))

  const isKeeping = (posting: SavedPosting) => keeping.has(keyOf(posting.url))

  return { pageFor, whileKeeping, keepAndReport, isKeeping }
}

export type PostingPages = ReturnType<typeof usePostingPages>
