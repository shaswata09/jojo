import { describe, expect, it } from 'vitest'
import { Cpu, PlugZap, Share, Waypoints } from 'lucide-react'
import type { StoreStatus } from '@jojo/service/react/status-context'
import {
  modelTile,
  runtimeTiles,
  storageTile,
  type ModelState,
} from '@/components/layout/runtime-tiles'
import { graphPath, transferPath } from '@/lib/links'
import sidebarRuntime from '@/components/layout/SidebarRuntime.tsx?raw'
import transferPage from '@/routes/Transfer.tsx?raw'

/**
 * The sidebar's runtime tiles and the Transfer page they open (G6).
 *
 * The tiles are plain functions in `runtime-tiles.ts`, so what each one says is
 * tested directly; the grid and the Transfer page are read as source (D20).
 */
const strip = (src: string) =>
  src
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

const healthy = {
  boot: { phase: 'ready' },
  health: { state: 'ok', unsaved: 0 },
} as unknown as StoreStatus

describe('the runtime tiles (Q060)', () => {
  it('include the graph and a share tile for Transfer', () => {
    const tiles = runtimeTiles(healthy, false, 'unset')
    expect(tiles.map((t) => t.to)).toEqual(expect.arrayContaining([graphPath(), transferPath()]))
    expect(tiles.find((t) => t.to === transferPath())?.icon).toBe(Share)
  })

  it('are laid out as a two-column grid of icon tiles', () => {
    const code = strip(sidebarRuntime)
    expect(code).toMatch(/<div className="grid grid-cols-2 /)
    expect(code).toMatch(/<r\.icon\b/)
  })
})

describe('the storage tile (Q104)', () => {
  it('draws the knowledge-graph icon and opens the graph', () => {
    const tile = storageTile(healthy, false)
    expect(tile.icon).toBe(Waypoints)
    expect(tile.to).toBe(graphPath())
    expect(tile.meta).toBe('saved here')
  })
})

describe('the model tile (Q105)', () => {
  it('shows the connected icon exactly when a model answered', () => {
    const states: ModelState[] = ['unset', 'probing', 'connected', 'unreachable']
    for (const state of states) {
      const tile = modelTile(state)
      expect(tile.icon, state).toBe(state === 'connected' ? PlugZap : Cpu)
      expect(tile.status === 'on', state).toBe(state === 'connected')
    }
  })

  it('says connected when connected, and not otherwise', () => {
    expect(modelTile('connected').meta).toBe('connected')
    expect(modelTile('unset').meta).not.toMatch(/connected/)
    expect(modelTile('unreachable').meta).not.toMatch(/connected/)
  })
})

describe('the Transfer page (Q060)', () => {
  const code = strip(transferPage)

  it('sends files only when asked — the switch starts off', () => {
    expect(code).toMatch(/const \[sendFiles, setSendFiles\] = useState\(false\)/)
  })

  it('has no "What moves" card and no demonstration copy', () => {
    expect(code).not.toMatch(/what moves/i)
    expect(code).not.toMatch(/demonstration/i)
  })
})
