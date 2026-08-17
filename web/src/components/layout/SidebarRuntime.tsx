import type { DotStatus } from '@/components/common/StatusDot'
import { graphPath, settingsPath, transferPath } from '@/lib/links'
import { useStoreStatus } from '@jojo/service/react/status-context'
import type { StoreStatus } from '@jojo/service/react/status-context'
import { useBoot } from '@/lib/boot-context'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { Cable, Cpu, Database, Share2 } from 'lucide-react'
import { useNavigate } from 'react-router'

type RuntimeTile = {
  label: string
  meta: string
  status: DotStatus
  icon: LucideIcon
  to: string
  /** The tooltip's version, where there is room for the whole sentence. */
  detail?: string
}

/**
 * The storage tile, read off the live store rather than written down.
 *
 * It used to be the constant `{ meta: 'in memory', status: 'warn' }` — true
 * while the store was compiled into memory on every load, and flatly false from
 * the moment it went to IndexedDB. It rendered on every page in every state,
 * including a perfectly healthy durable one, and this is the first place a
 * person looks to find out whether their work is safe: a permanent amber dot
 * saying "in memory" tells them it is not, and they would have been right to
 * believe it.
 *
 * The three not-saving cases collapse into one reading on purpose. Which of
 * them it is — another tab holding the database, no room left, a browser that
 * refuses storage — is `StorageBanner`'s job, and it is already on screen above
 * the route with the sentence and the fix in it. A 50px tile repeating a
 * distinction it has no room to explain would only compete with that.
 */
function storageTile(status: StoreStatus, interrupted: boolean): RuntimeTile {
  // Storage opens the Graph rather than Settings. The tile says where your
  // records are being held, and the graph is the honest answer to that — the
  // records themselves, drawn. Settings only has a notice about the same thing.
  const tile = { label: 'Browser storage', icon: Database, to: graphPath() }

  if (interrupted || status.boot.phase === 'unavailable' || status.health.state === 'off') {
    return {
      ...tile,
      meta: 'not saving',
      status: 'warn',
      detail: 'your records are not being saved — the banner above the page says why',
    }
  }

  if (status.health.state === 'degraded') {
    return {
      ...tile,
      meta: 'retrying',
      status: 'warn',
      // The user's actions, not the rows they touched — see `unsavedIn`.
      detail: `${status.health.unsaved} change${status.health.unsaved === 1 ? '' : 's'} could not be saved yet, and jojo is still retrying`,
    }
  }

  // 'saved here', not 'saving' or a byte count. The tense is the point: what a
  // person wants from this tile is whether their work is already safe, and a
  // present participle answers a different question. It is also honest while
  // the queue is draining — `writing` means one batch is in flight behind a
  // commit that has already landed in memory, which is a millisecond, not a
  // state worth flickering the sidebar for.
  return {
    ...tile,
    meta: 'saved here',
    status: 'on',
    detail: "your records are written to this browser's database as you work",
  }
}

/**
 * What the four runtime pieces are actually doing.
 *
 * These read '14.2 MB', '2m ago' and a green dot on the bridge — numbers for a
 * sync that has never run and a store that is not on disk. A status strip whose
 * figures are invented is worse than none: it is the one place a reader looks
 * to find out whether their data is safe. Each now states the real state, and
 * the tile still opens Settings, where each is configured.
 */
function runtimeTiles(status: StoreStatus, interrupted: boolean): RuntimeTile[] {
  return [
    storageTile(status, interrupted),
    // 'no bridge', not 'not connected': at four across a tile is ~50px, and
    // 'connected' neither fits on one line nor breaks anywhere useful, so it
    // ran straight through the tile's borders on both sides. Every meta on this
    // row is now two short words at most, and the full state is in the tooltip
    // and the accessible name.
    {
      label: 'Localhost bridge',
      meta: 'no bridge',
      status: 'off',
      icon: Cable,
      to: settingsPath(),
    },
    { label: 'Local model', meta: 'offline', status: 'off', icon: Cpu, to: settingsPath() },
    // Fourth on the row because it belongs to the same subject: where the records
    // live, and how they get to another device. 'no device' rather than a
    // readiness word — nothing is paired, and a tile that read 'ready' would be
    // claiming a connection this build never opens.
    { label: 'Transfer', meta: 'no device', status: 'off', icon: Share2, to: transferPath() },
  ]
}

/** Named in each tile's tooltip, so a click never lands somewhere unannounced. */
const RUNTIME_DEST: Record<string, string> = {
  [graphPath()]: 'the graph',
  [transferPath()]: 'Transfer',
  [settingsPath()]: 'Settings',
}

/** Status carried by the icon's colour once the dot and the label are gone. */
const RUNTIME_TONE: Record<DotStatus, string> = {
  on: 'text-success',
  warn: 'text-warning',
  off: 'text-text-3',
}

/** The four runtime tiles, pinned to the foot of the column. */
export function SidebarRuntime({ tabIndex }: { tabIndex?: number }) {
  const status = useStoreStatus()
  const { interrupted } = useBoot()
  const runtime = runtimeTiles(status, interrupted)
  const navigate = useNavigate()

  return (
    <div className="mt-auto flex flex-col gap-[7px] pt-4">
      <div className="px-2.5 pb-0.5 text-xs tracking-wide text-text-3 uppercase">Runtime</div>
      {/* Icon over value, four up. Colour carries health, the icon carries
          what it is, the text carries the value. The label survives as the
          tooltip and as the accessible name — an icon above "saved here" says
          nothing on its own, and colour alone would be the only signal of
          trouble.

          Each tile now names its own destination rather than all four going
          to Settings: storage opens the Graph (the records it is talking
          about, drawn), Transfer opens the handoff, and the bridge and the
          model still open Settings, where they are configured. The `title`
          says which, so no tile takes a click somewhere unannounced. */}
      {/* Two by two rather than four across. A quarter of a 232px rail is
          ~50px, which is narrower than the words it has to hold — half is
          ~110px, so every value fits on one line and the icons stop being
          the only thing readable at a glance. */}
      <div className="grid grid-cols-2 gap-1.5">
        {runtime.map((r) => (
          <button
            key={r.label}
            type="button"
            onClick={() => navigate(r.to)}
            title={`${r.label} — ${r.detail ?? r.meta}. Opens ${RUNTIME_DEST[r.to] ?? 'Settings'}`}
            // Not tabbable while the drawer is closed off-screen, matching
            // the nav links above.
            tabIndex={tabIndex}
            className="pressable flex cursor-pointer flex-col items-center gap-1 rounded-md border border-hairline bg-well px-1 py-2 transition-colors hover:border-hairline-strong hover:bg-row-hover active:bg-well"
          >
            <r.icon
              aria-hidden
              strokeWidth={1.8}
              className={cn('size-4 shrink-0', RUNTIME_TONE[r.status])}
            />
            <span className="sr-only">{r.label}: </span>
            {/* Wraps rather than `whitespace-nowrap`: a quarter of a 240px
                rail is ~50px and "not connected" is wider than that, so
                nowrap spilled the words straight through the tile's border.
                The grid stretches all four, so two lines here still line up. */}
            <span className="text-center text-xs leading-tight text-balance text-text-2">
              {r.meta}
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
