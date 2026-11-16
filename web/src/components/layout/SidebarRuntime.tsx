import { graphPath, settingsPath, transferPath } from '@/lib/links'
import { useStoreStatus } from '@jojo/service/react/status-context'
import { useBoot } from '@/lib/boot-context'
import { cn } from '@/lib/utils'
import type { DotStatus } from '@/components/common/StatusDot'
import { useNavigate } from 'react-router'
import { useEffect, useState } from 'react'
import { listModels } from '@/lib/llm'
import { useModelSettings } from '@/lib/model-settings-context'
import { runtimeTiles, type ModelState } from '@/components/layout/runtime-tiles'

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
    // The guided tour lights the whole block, heading and tiles (components/tour).
    <div className="mt-auto flex flex-col gap-[7px] pt-4" data-tour="runtime">
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
