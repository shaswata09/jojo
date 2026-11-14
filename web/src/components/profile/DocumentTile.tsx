import { FileText, Trash2 } from 'lucide-react'
import { Chip } from '@/components/common/Chip'
import type { VaultFile } from '@/data/vault'
import { displayName } from '@/data/seed'
import { agoLabel } from '@/data/timeline'
import type { Application } from '@jojo/service/data/seed'
import { TODAY } from '@/lib/today'

/** One document in the Profile's Documents grid: opens on press, deletes from the corner. */
export function DocumentTile({
  file: f,
  get,
  onOpen,
  onDelete,
}: {
  file: VaultFile
  /** The application an id names, if it still exists. */
  get: (id: string) => Application | undefined
  onOpen: (id: string) => void
  onDelete: (file: VaultFile) => void
}) {
  // The edges are cleared, not followed, when an application is
  // deleted — so a file can name ids whose records have gone.
  const applications = f.applicationIds.map((id) => get(id)).filter((app) => app !== undefined)
  return (
    // `relative`, because the delete sits on top of the open
    // button rather than after it. A button inside a button is
    // invalid and the browser resolves it by ignoring one of them.
    <li className="group relative">
      {/* Every row opens, including the ones with no bytes behind
          them. `FileViewer` generates a placeholder for those and
          says so in it — which is what the Vault's files tool
          already does with the same records. Disabling them here
          was the first attempt and it was wrong twice over: it
          made the seeded documents inert on the page most likely
          to be someone's first, and it made the same record
          openable in one place and not the other. */}
      <button
        type="button"
        title={`Open ${f.name}`}
        onClick={() => onOpen(f.id)}
        className="pressable w-full cursor-pointer rounded-lg border border-hairline bg-well p-3 text-left transition-colors hover:border-hairline-strong"
      >
        <span className="flex items-center gap-2">
          <FileText className="size-4 shrink-0 text-accent" strokeWidth={1.7} aria-hidden />
          <span className="truncate font-mono text-sm">{f.name}</span>
        </span>
        <span className="tabular mt-1.5 block text-xs text-text-3">
          {f.size} · saved {agoLabel(f.savedOn, TODAY)}
        </span>
        {f.note ? (
          <span className="mt-1 line-clamp-2 block text-xs text-text-3">{f.note}</span>
        ) : null}
        {/* One chip per job. A CV goes to every application you
            send it to, and showing one of them would misreport
            which. */}
        {applications.length > 0 ? (
          <span className="mt-2 flex flex-wrap gap-1">
            {applications.map((app) => (
              <Chip key={app.id} tone="teal" size="sm">
                {displayName(app)}
              </Chip>
            ))}
          </span>
        ) : null}
      </button>

      {/* Shown on hover and whenever it has focus.
          Hover alone would put it out of reach of a keyboard, and
          always-visible would put a delete under the pointer on
          every tile in a grid people scan. `focus-within` on the
          tile covers the tab that lands on the open button, so the
          control appears before it is reached. */}
      <button
        type="button"
        aria-label={`Delete ${f.name}`}
        title={`Delete ${f.name}`}
        onClick={() => {
          onDelete(f)
        }}
        className="pressable absolute top-2 right-2 cursor-pointer rounded-md p-1.5 text-text-3 opacity-0 transition group-focus-within:opacity-100 group-hover:opacity-100 hover:bg-danger-soft hover:text-danger focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <Trash2 className="size-3.5" strokeWidth={1.8} aria-hidden />
      </button>
    </li>
  )
}
