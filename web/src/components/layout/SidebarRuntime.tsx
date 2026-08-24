import type { DotStatus } from '@/components/common/StatusDot'
import { graphPath, settingsPath, transferPath } from '@/lib/links'
import { useStoreStatus } from '@jojo/service/react/status-context'
import type { StoreStatus } from '@jojo/service/react/status-context'
import { useBoot } from '@/lib/boot-context'
import { cn } from '@/lib/utils'
import type { LucideIcon } from 'lucide-react'
import { Cpu, PlugZap, Share, Waypoints } from 'lucide-react'
import { useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { listModels } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'

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
  // `Waypoints` — nodes joined by edges — rather than the `Database` cylinder
  // this used to carry. The tile opens the GRAPH, and the graph is what it is
  // reporting on: a database drum says "a table somewhere", which is neither
  // what jojo stores nor where the click lands.
  const tile = { label: 'Browser storage', icon: Waypoints, to: graphPath() }

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
/** What the model tile can be. `probing` only ever shows for the first moment. */
type ModelState = 'unset' | 'probing' | 'connected' | 'unreachable'

/**
 * The model tile, answered by asking the model rather than by reading a setting.
 *
 * It was the constant `{ meta: 'offline', status: 'off' }`, which was true when
 * nothing could reach a model and became false the moment something could.
 *
 * Configured is NOT connected, and the difference is the whole point of the
 * tile: an endpoint saved months ago on a laptop whose Ollama is not running
 * would report "connected" on a settings read, and a person would believe the
 * assistant was available until it failed. So this probes — `listModels` is the
 * same call the Test button makes.
 *
 * Not on a timer. This is a 50px tile, not a monitor, and a poll every few
 * seconds against someone's localhost for a status nobody is watching is a cost
 * with no reader.
 *
 * But once per endpoint was too few, and the gap was the whole complaint: the
 * commonest way to see this tile is to notice it says "no answer", go and start
 * Ollama, and come back — at which point nothing had changed that this effect
 * watched, so it went on saying "no answer" for the rest of the session while a
 * model sat there answering. The endpoint changing is not the only moment the
 * answer can differ; it is only the moment the SETTINGS can.
 *
 * So it also re-probes when the tab is looked at again. That is the exact moment
 * somebody who has just started a server switches back, it costs one request per
 * return rather than one per interval, and it costs nothing at all while the tab
 * sits in the background — which is where a tab spends most of its life.
 */
function useModelState(): ModelState {
  const { settings } = useModelSettings()
  const endpoint = settings.endpoint.trim()
  const [state, setState] = useState<ModelState>(endpoint === '' ? 'unset' : 'probing')

  /*
   * Bumped to ask again. A counter rather than a boolean because the same
   * answer twice is a real outcome — "still not there" has to re-run the effect.
   */
  const [recheck, setRecheck] = useState(0)

  useEffect(() => {
    // Only when the tab is actually being looked at. `visibilitychange` fires on
    // tab switches; `focus` covers coming back from another window, which is
    // where the terminal that just started the server lives.
    const again = () => {
      if (document.visibilityState === 'visible') setRecheck((n) => n + 1)
    }
    window.addEventListener('focus', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      window.removeEventListener('focus', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [])

  useEffect(() => {
    if (endpoint === '') {
      setState('unset')
      return
    }
    setState('probing')
    // Aborted on unmount and on an endpoint change, so a slow answer for the
    // previous endpoint cannot arrive and overwrite the current one.
    const stop = new AbortController()
    void listModels(settings, stop.signal)
      .then((result) => {
        if (!stop.signal.aborted) setState(result.ok ? 'connected' : 'unreachable')
      })
      .catch(() => {
        if (!stop.signal.aborted) setState('unreachable')
      })
    return () => stop.abort()
    // `settings`, not `endpoint`. `listModels` reads the key and the provider
    // too, and the cloud providers pin their endpoint — so choosing Anthropic
    // saved an endpoint with an empty key, the probe 401'd, and pasting the key
    // changed nothing this effect watched. The tile then read "configured but
    // did not answer" for the rest of the session, on every page, while the
    // assistant worked. Only a reload cleared it.
  }, [endpoint, settings, recheck])

  return state
}

function modelTile(state: ModelState): RuntimeTile {
  const tile = { label: 'Local model', to: settingsPath() }
  switch (state) {
    case 'connected':
      return {
        ...tile,
        meta: 'connected',
        status: 'on',
        // The one tile that changes its icon as well as its dot. A plug with
        // current in it reads at 50px where a second processor chip does not.
        icon: PlugZap,
        detail: 'a local model answered — the assistant and scout scoring can use it',
      }
    case 'unreachable':
      return {
        ...tile,
        meta: 'no answer',
        status: 'warn',
        icon: Cpu,
        detail: 'a model is configured but did not answer — check it is running',
      }
    case 'probing':
      return { ...tile, meta: 'checking', status: 'off', icon: Cpu, detail: 'asking the model whether it is there' }
    default:
      return {
        ...tile,
        meta: 'not set up',
        status: 'off',
        icon: Cpu,
        detail: 'no model endpoint yet — Settings is where one goes',
      }
  }
}

function runtimeTiles(status: StoreStatus, interrupted: boolean, model: ModelState): RuntimeTile[] {
  return [
    storageTile(status, interrupted),
    // A 'Localhost bridge' tile stood here and pointed at a Settings panel that
    // no longer exists. It went with the panel: documents are stored in the
    // browser now, so there is no companion process to be connected to and no
    // state for a tile to report. Every meta on this row is two short words at
    // most — at four across a tile is ~50px, and a longer word ran straight
    // through the borders on both sides.
    modelTile(model),
    // Last on the row because it belongs to the same subject as the first: where
    // the records live, and how they get to another device.
    //
    // The one tile that names what it DOES rather than what state it is in, and
    // it can afford to because it is the odd one out on a two-column row and
    // spans both. The other two are statuses read off something live — the store
    // is saving or it is not, the model answered or it did not — while nothing
    // about Transfer changes until someone starts it. 'no device' was the
    // status, and it was accurate and useless: a person reading it learned that
    // a thing they had not heard of was not doing anything.
    //
    // The status did not go, it moved to the tooltip, where there is room for it
    // and where it is not the first thing read.
    //
    // `Share` — the box with an arrow leaving it — rather than `Share2`, which
    // is three connected dots and had become the second node-graph glyph on this
    // row once storage took `Waypoints`. Two tiles that look like the same
    // diagram are two tiles nobody can tell apart at 50px. `Download` and
    // `Upload` were not available to borrow: DataPanel already spends both on
    // backup and restore, and a third meaning would blunt those.
    {
      label: 'Transfer',
      meta: 'Sync with Other Device',
      status: 'off',
      icon: Share,
      to: transferPath(),
      detail: 'no device is paired yet — Transfer is where one is added',
    },
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

/** The three runtime tiles, pinned to the foot of the column. */
export function SidebarRuntime({ tabIndex }: { tabIndex?: number }) {
  const status = useStoreStatus()
  const { interrupted } = useBoot()
  const model = useModelState()
  const runtime = runtimeTiles(status, interrupted, model)
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
      {/* Two columns rather than one per tile. A quarter of a 232px rail is
          ~50px, which is narrower than the words it has to hold — half is
          ~110px, so every value fits on one line and the icons stop being the
          only thing readable at a glance.
 
          There were four tiles and this was a tidy 2x2. Removing the localhost
          bridge left three, and an odd count in a two-column grid leaves a hole
          beside the last one — which reads as a tile that failed to render
          rather than as a row that happens to be odd. The last tile spans both
          columns instead, so the block still ends on a straight edge. */}
      <div className="grid grid-cols-2 gap-1.5 [&>*:last-child:nth-child(odd)]:col-span-2">
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
