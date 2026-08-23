import { Link } from 'react-router'
import { Archive, FileText, Link2, MessageSquare, Scissors } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Panel, PanelTitle } from '@/components/common/Panel'
import { useVault } from '@jojo/service/react/use-vault'
import { useThreads } from '@jojo/service/react/use-threads'
import { assistantPath, vaultPath } from '@/lib/links'

/**
 * Everything filed under this application.
 *
 * The three vault collections have carried an `applicationId` since the graph
 * landed, and the delete confirmation on this very page counted them — "4 files
 * will be kept but unlinked" — so the page knew what was attached and showed
 * none of it. Filing a document under a job and then finding no trace of it on
 * the job is the shape of bug that makes people stop filing.
 *
 * The field it filters on is a LIST now — `FILED_UNDER` is
 * `fromCardinality: 'many'` — so one CV appears on every application it was
 * sent to rather than on whichever one displaced the others. Nothing here
 * changed for it: the filter lives in `forApplication`, which is the point of
 * having the selector.
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
  const { threads } = useThreads()
  const filed = forApplication(applicationId)

  /**
   * Conversations filed here, listed beside the documents.
   *
   * They arrive on the same `FILED_UNDER` edge a document does, which is why
   * they belong on this panel rather than on one of their own: a person who
   * filed a conversation under the Rice job meant "this is about Rice", and a
   * panel headed "everything filed here" that quietly left one kind out would
   * make the filing look like it had not worked.
   */
  const conversations = threads.filter((t) => t.applicationId === applicationId)

  const total =
    filed.files.length + filed.links.length + filed.snippets.length + conversations.length

  return (
    <Panel>
      <PanelTitle hint={total > 0 ? `${total} filed here` : undefined}>From the Vault</PanelTitle>

      {total === 0 ? (
        <EmptyState
          icon={Archive}
          title="Nothing filed under this yet"
          description="Documents, links and snippets can each be filed under as many jobs as they went to. File one under this job — from its row menu in the Vault — and it shows up here."
        />
      ) : (
        <div className="space-y-4">
          {conversations.length > 0 ? (
            <li>
              <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-3">
                <MessageSquare className="size-3.5" strokeWidth={1.8} aria-hidden />
                Conversations
              </h3>
              <ul className="space-y-1">
                {conversations.map((t) => (
                  <li key={t.id}>
                    <Link
                      to={assistantPath()}
                      className="pressable block truncate rounded-md border border-hairline bg-well px-2.5 py-1.5 text-sm text-text-1 transition-colors hover:border-hairline-strong"
                    >
                      {t.title}
                      <span className="ml-2 text-xs text-text-3">
                        {t.entries.filter((e) => e.kind === 'you').length} asked
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

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
