import { describe, expect, it } from 'vitest'
import { OFFER_BYTES } from '@jojo/service/core/pairing'
import { pairingQr, qrPath } from './pairing-qr'

const offer = Uint8Array.from({ length: OFFER_BYTES }, (_, i) => (i * 37 + 11) & 0xff)

describe('pairingQr', () => {
  it('fits an offer into a version-5 code, 37 modules across', () => {
    const qr = pairingQr(offer)
    expect(qr.size).toBe(37)
    expect(qr.modules).toHaveLength(37)
    for (const row of qr.modules) expect(row).toHaveLength(37)
  })

  it('has no border of its own, so the card’s padding is the whole quiet zone', () => {
    const qr = pairingQr(offer)
    // A finder pattern's dark outer ring starts at the very first module.
    expect(qr.modules[0]![0]).toBe(true)
    expect(qr.modules[0]![6]).toBe(true)
    expect(qr.modules[6]![0]).toBe(true)
  })

  it('changes with the offer', () => {
    const other = offer.slice()
    other[40] ^= 0xff
    expect(pairingQr(other).modules).not.toEqual(pairingQr(offer).modules)
  })
})

describe('qrPath', () => {
  it('merges a run of dark modules into one rectangle', () => {
    expect(qrPath({ size: 4, modules: [[true, true, false, true]] })).toBe(
      'M0 0h2v1h-2zM3 0h1v1h-1z',
    )
  })

  it('draws exactly the dark modules of a real code', () => {
    const qr = pairingQr(offer)
    const dark = qr.modules.flat().filter(Boolean).length
    // Each rectangle is one run; its widths add up to the dark modules.
    const widths = [...qrPath(qr).matchAll(/h(\d+)v1/g)].map((m) => Number(m[1]))
    expect(widths.reduce((a, b) => a + b, 0)).toBe(dark)
  })
})
