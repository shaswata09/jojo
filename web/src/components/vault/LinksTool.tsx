import { useMemo, useState } from 'react'
import { ExternalLink, Link2 } from 'lucide-react'
import { BucketFilter } from '@/components/common/BucketFilter'
import { LabelChips, LabelPicker } from '@/components/common/LabelFilter'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel } from '@/components/common/Panel'
import { LINK_CATEGORIES, vaultLinks, type LinkCategory } from '@/data/vault'
import { useLabels } from '@/lib/labels-context'

/** Strips the scheme and any trailing slash, so the host reads at a glance. */
function hostOf(url: string) {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

/**
 * Saved URLs, filed by what they are.
 *
 * These open for real — an anchor to somewhere else on the web needs no local
 * store — so this is one of the few things in the app that already works end to
 * end rather than waiting on persistence.
 */
export function LinksTool() {
  const [bucket, setBucket] = useState<LinkCategory | 'all'>('all')
  const { matches } = useLabels()

  const counts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const l of vaultLinks) map[l.category] = (map[l.category] ?? 0) + 1
    return map
  }, [])

  const visible = vaultLinks.filter(
    (l) => (bucket === 'all' || l.category === bucket) && matches(l.id),
  )

  return (
    <Panel className="min-w-0">
      <div className="mb-3.5">
        <BucketFilter
          label="Filter links by category"
          options={LINK_CATEGORIES}
          counts={counts}
          value={bucket}
          onChange={setBucket}
          total={vaultLinks.length}
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={Link2}
          title="No links here yet"
          description="Paste a URL into the vault to keep a posting, a department page or a person to hand."
        />
      ) : (
        <ul className="divide-y divide-hairline">
          {visible.map((l) => (
            <li key={l.id} className="flex items-start gap-1">
              <a
                href={l.url}
                target="_blank"
                // noreferrer as well as noopener: the target should not learn
                // where the click came from.
                rel="noopener noreferrer"
                className="group flex min-w-0 flex-1 items-start gap-3 py-3"
              >
                <Link2
                  aria-hidden
                  strokeWidth={1.7}
                  className="mt-0.5 size-3.5 shrink-0 text-text-3"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-text-1 group-hover:underline">
                    {l.title}
                  </span>
                  <span className="mt-0.5 block truncate font-mono text-xs text-text-3">
                    {hostOf(l.url)}
                  </span>
                  {l.note ? (
                    <span className="mt-0.5 block truncate text-xs text-text-3">{l.note}</span>
                  ) : null}
                  <LabelChips recordId={l.id} className="mt-1.5" />
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-xs whitespace-nowrap text-text-3">{l.savedAgo}</span>
                  <ExternalLink
                    aria-hidden
                    strokeWidth={1.7}
                    className="mt-1 ml-auto size-3.5 text-text-3 opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </span>
              </a>
              {/* Outside the anchor on purpose — nested inside it, opening the
                  popover would also follow the link. */}
              <LabelPicker recordId={l.id} className="mt-3.5" />
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
