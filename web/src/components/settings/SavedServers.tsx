import { KeyRound, Trash2 } from 'lucide-react'
import type { ModelServer } from '@jojo/service/core/model-server'
import { Chip } from '@/components/common/Chip'
import { providerMeta } from '@jojo/service/core/provider'

/**
 * The addresses this browser has connected to before.
 *
 * Only servers that answered get in here. Nothing is written on typing, so a row
 * is a claim that the address worked at least once, and Load is safe to treat as
 * connected without a fresh round trip.
 *
 * Delete is immediate and unconfirmed, which is deliberate: it forgets an
 * address, and the recovery is typing it again. A confirmation dialog would cost
 * more than the mistake does.
 */
export function SavedServers({
  servers,
  current,
  onLoad,
  onForget,
}: {
  servers: readonly ModelServer[]
  /*
   * The address AND the model, because a hosted provider has several saved rows
   * sharing one endpoint. Comparing addresses alone marked every NVIDIA model
   * "In use" at once — a badge that is true of everything says nothing.
   */
  current: { endpoint: string; model: string }
  onLoad: (server: ModelServer) => void
  onForget: (id: string) => void
}) {
  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-hairline">
      <p className="border-b border-hairline bg-well px-3 py-2 text-xs text-text-3">
        Saved connections — everything that has answered here, ready to load back whole. A key is
        kept beside the address on this device; it never enters a backup.
      </p>
      <ul className="divide-y divide-hairline">
        {servers.map((server) => (
          <li key={server.id} className="flex items-center gap-2 px-3 py-2">
            <button
              type="button"
              className="min-w-0 flex-1 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => {
                onLoad(server)
              }}
            >
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-text-1">{server.name}</span>
                {/* Which one is in the fields right now. Two saved servers on
                    one machine differ by a port, and a list of near-identical
                    URLs with nothing marked is a list you read character by
                    character. */}
                {server.endpoint === current.endpoint && server.model === current.model ? (
                  <Chip tone="green">In use</Chip>
                ) : null}
              </span>
              <span className="block truncate font-mono text-xs text-text-3">
                {server.endpoint}
              </span>
              <span className="block truncate text-xs text-text-3">{server.model}</span>
              {/* Which provider, and whether it can be used without pasting a
                  key again. A list of addresses answered "which server"; a list
                  that has to cover Claude and NVIDIA has to answer "which
                  setup", and the key is the part that used to be missing. */}
              <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-text-3">
                <span>
                  {providerMeta(server.provider ?? 'openai-compatible').label.split(' —')[0]}
                </span>
                {server.apiKey ? (
                  <span className="flex items-center gap-1 text-text-3">
                    <KeyRound className="size-3" strokeWidth={1.8} aria-hidden />
                    key kept
                  </span>
                ) : null}
              </span>
              <span className="sr-only">
                Load {server.name}
                {server.apiKey ? ', including its key' : ''}
              </span>
            </button>
            <button
              type="button"
              className="rounded-md p-1.5 text-text-3 transition-colors hover:bg-well hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              onClick={() => {
                onForget(server.id)
              }}
            >
              <Trash2 className="size-4" aria-hidden />
              <span className="sr-only">Forget {server.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
