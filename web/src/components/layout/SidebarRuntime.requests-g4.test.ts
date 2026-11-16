import { describe, expect, it } from 'vitest'
import { Share } from 'lucide-react'
import type { StoreStatus } from '@jojo/service/react/status-context'
import { runtimeTiles } from '@/components/layout/runtime-tiles'
import { transferPath } from '@/lib/links'

/**
 * Q106 and Q107: the sidebar's Transfer tile, read off the pure tile list.
 *
 * Q106 asked for the "no device" glyph to become an export icon — `Share`, the
 * box with an arrow leaving it. Q107 asked for the tile to read "Sync with
 * Other Device" instead of the status it used to show.
 */

const healthy = {
  boot: { phase: 'ready' },
  health: { state: 'ok', unsaved: 0 },
} as unknown as StoreStatus

const transferTile = () =>
  runtimeTiles(healthy, false, 'unset').find((t) => t.to === transferPath())

describe('the Transfer tile (Q106, Q107)', () => {
  it('reads "Sync with Other Device"', () => {
    expect(transferTile()?.meta).toBe('Sync with Other Device')
  })

  it('draws the export icon whatever state the device is in', () => {
    for (const model of ['unset', 'probing', 'connected', 'unreachable'] as const) {
      const tile = runtimeTiles(healthy, false, model).find((t) => t.to === transferPath())
      expect(tile?.icon).toBe(Share)
      expect(tile?.meta).not.toMatch(/no device/i)
    }
  })
})
