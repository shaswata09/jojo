import { Link } from 'react-router'
import { Archive, FileText, Link2, Scissors } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { useVault } from '@jojo/service/react/use-vault'
import { vaultPath } from '@/lib/links'

/**
 * Everything filed under this application.
 *
 * The three vault collections have carried an `applicationId` since the graph
 * landed, and the delete confirmation on this very page counted them — "4 files
 * will be kept but unlinked" — so the page knew what was attached and showed
 * none of it. Filing a document under a job and then finding no trace of it on
 * the job is the shape of bug that makes people stop filing.
 *
 * Three sections rather than one merged list: a link opens a URL, a file opens a
 * document and a snippet is text to copy, so they are different rows with
 * different destinations. Merging them would mean re-splitting them to render.
 *
 * Every row lands on the record in its own tool, with `focus` set so the Vault
 * scrolls to it and highlights it. That is the same arrival the calendar and the
 * reminders list already use, so the highlight means one thing everywhere.
 */

const SECTIONS = [
  { key: 'files', tool: 'files', label: 'Files', icon: FileText },
  { key: 'links', tool: 'links', label: 'Links', icon: Link2 },
  { key: 'snippets', tool: 'snippets', label: 'Snippets', icon: Scissors },
] as const satisfies readonly {
  key: 'files' | 'links' | 'snippets'
  tool: 'files' | 'links' | 'snippets'
  label: string
  icon: LucideIcon
}[]

export function FiledPanel({ applicationId }: { applicationId: string }) {
  const { forApplication } = useVault()
  const filed = forApplication(applicationId)

  const total = filed.files.length + filed.links.length + filed.snippets.length

  return (
    <Panel>
      <PanelTitle hint={total > 0 ? `${total} filed here` : undefined}>From the Vault</PanelTitle>

      {total === 0 ? (
        <EmptyState
          icon={Archive}
          title="Nothing filed under this yet"
          description="Documents, links and snippets each take one application. File one under this job — from its row menu in the Vault — and it shows up here."
        />
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((section) => {
            const rows = filed[section.key]
            if (rows.length === 0) return null
            return (
              <section key={section.key}>
                <h3 className="mb-1.5 flex items-center gap-1.5 text-xs text-text-3">
                  <section.icon aria-hidden strokeWidth={1.8} className="size-3.5" />
                  {section.label}
                  <span className="tabular">{rows.length}</span>
                </h3>
                <ul className="space-y-0.5">
                  {rows.map((row) => (
                    <li key={row.id}>
                      <Link
                        to={vaultPath({ tool: section.tool, focus: row.id })}
                        className="flex items-baseline gap-2 rounded-sm px-1 py-1 transition-colors hover:bg-row-hover"
                      >
                        <span
                          className={`min-w-0 flex-1 truncate text-sm text-text-1 ${
                            section.key === 'files' ? 'font-mono' : ''
                          }`}
                        >
                          {'name' in row ? row.name : row.title}
                        </span>
                        {/* The one word that says which of its own list it is
                            in — a bucket, a category, a tag. Not the same field
                            on the three shapes, which is why it is read here
                            rather than declared in SECTIONS. */}
                        <span className="shrink-0 text-xs text-text-3">
                          {'bucket' in row ? row.bucket : 'category' in row ? row.category : row.tag}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}
    </Panel>
  )
}
