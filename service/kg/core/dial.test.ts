/**
 * The typed code, and the rule about which addresses jojo will dial.
 *
 * Two very different jobs in one file. The codec's failures are ordinary — a
 * mistyped code that decodes to the wrong machine wastes somebody's time. The
 * address rule's failures are not: a range wrongly admitted is a backup taking a
 * route across the internet that the UI said it would not take, so the ranges
 * below are enumerated at their BOUNDARIES rather than sampled in the middle.
 */

import { describe, expect, it } from 'vitest'
import {
  decodeAddress,
  encodeAddress,
  formatAddress,
  groupCode,
  isPrivateAddress,
  looksSameNetwork,
  type DialAddress,
} from './dial'

const at = (host: string, port: number): DialAddress => {
  const parts = host.split('.').map(Number)
  return { host: [parts[0]!, parts[1]!, parts[2]!, parts[3]!], port }
}

describe('a code somebody has to read off one screen and type into another', () => {
  it('round-trips the addresses a home network actually hands out', () => {
    for (const host of ['192.168.1.42', '10.0.0.7', '172.16.31.255', '169.254.10.1']) {
      for (const port of [1, 8080, 49152, 65535]) {
        const address = at(host, port)
        const read = decodeAddress(encodeAddress(address))
        expect(read.ok, `${host}:${port}`).toBe(true)
        if (read.ok) expect(formatAddress(read.value), `${host}:${port}`).toBe(`${host}:${port}`)
      }
    }
  })

  it('round-trips every octet value, so no byte is mangled', () => {
    // A wrong entry in the alphabet corrupts one value in 32 — often enough to
    // send someone to the wrong machine, rare enough to survive a test that
    // only uses 192.168.1.x.
    for (let v = 0; v < 256; v += 1) {
      const address = at(`${v}.${255 - v}.${(v * 7) % 256}.${(v * 13) % 256}`, (v * 257) % 65536)
      const read = decodeAddress(encodeAddress(address))
      expect(read.ok, `octet ${v}`).toBe(true)
      if (read.ok) expect([...read.value.host], `octet ${v}`).toEqual([...address.host])
    }
  })

  it('is short enough to say out loud', () => {
    const code = encodeAddress(at('192.168.1.42', 49152))
    expect(code).toHaveLength(12)
    expect(groupCode(code)).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/)
  })

  it('has no character anyone confuses with another', () => {
    // I/1, L/1, O/0 are the pairs people get wrong copying between screens.
    const code = encodeAddress(at('255.255.255.255', 65535))
    expect(code).not.toMatch(/[ILOU]/)
  })

  it('forgives the substitutions people actually make', () => {
    const address = at('192.168.1.42', 49152)
    const code = encodeAddress(address)
    // Someone reading O for 0 and I or L for 1 — and typing it in lower case,
    // with the grouping dashes, or with spaces they added themselves.
    const mangled = code.replace(/0/g, 'O').replace(/1/g, 'I').toLowerCase()
    const read = decodeAddress(groupCode(mangled).replace('-', ' - '))
    expect(read.ok).toBe(true)
    if (read.ok) expect(formatAddress(read.value)).toBe('192.168.1.42:49152')
  })

  it('catches two characters swapped, which is the commonest mistake of all', () => {
    // A plain sum would not notice this at all.
    const code = encodeAddress(at('192.168.1.42', 49152))
    for (let i = 0; i + 1 < 10; i += 1) {
      if (code[i] === code[i + 1]) continue
      const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2)
      const read = decodeAddress(swapped)
      expect(read.ok, `swap at ${i}`).toBe(false)
      if (!read.ok) expect(read.error, `swap at ${i}`).toBe('dial/mistyped')
    }
  })

  it('catches EVERY single character typed wrong, across many codes', () => {
    // Exhaustive rather than sampled. A one-character check (mod 32) passes a
    // spot check and quietly admits a whole class — any substitution whose
    // difference is a multiple of 16 at an even position — which is what the
    // first cut of this file did.
    let checked = 0
    for (const host of ['10.0.0.7', '192.168.1.42', '172.20.13.200', '169.254.99.1']) {
      for (const port of [1, 8080, 49152, 65535]) {
        const code = encodeAddress(at(host, port))
        for (let i = 0; i < code.length; i += 1) {
          for (const ch of '0123456789ABCDEFGHJKMNPQRSTVWXYZ') {
            if (ch === code[i]) continue
            const read = decodeAddress(code.slice(0, i) + ch + code.slice(i + 1))
            expect(read.ok, `${host}:${port} pos ${i} -> ${ch}`).toBe(false)
            if (!read.ok) expect(read.error).toBe('dial/mistyped')
            checked += 1
          }
        }
      }
    }
    // 16 codes x 12 positions x 31 wrong characters.
    expect(checked).toBe(16 * 12 * 31)
  })

  it('catches every transposition of two adjacent characters', () => {
    let checked = 0
    for (const host of ['10.0.0.7', '192.168.1.42', '172.20.13.200']) {
      const code = encodeAddress(at(host, 49152))
      for (let i = 0; i + 1 < code.length; i += 1) {
        if (code[i] === code[i + 1]) continue
        const swapped = code.slice(0, i) + code[i + 1] + code[i] + code.slice(i + 2)
        expect(decodeAddress(swapped).ok, `${host} swap ${i}`).toBe(false)
        checked += 1
      }
    }
    expect(checked).toBeGreaterThan(20)
  })

  it('says which kind of wrong it was, because the fixes differ', () => {
    // "You mistyped it" and "that is not a jojo code" send a person to different
    // places, and a single 'invalid' would send them to neither.
    expect(decodeAddress('ZZZZ!!!!ZZZ')).toEqual({ ok: false, error: 'dial/unreadable' })
    expect(decodeAddress('ABCD')).toEqual({ ok: false, error: 'dial/length' })
    expect(decodeAddress('')).toEqual({ ok: false, error: 'dial/length' })
    expect(decodeAddress('ABCDEFGHJKMNPQ')).toEqual({ ok: false, error: 'dial/length' })
    expect(decodeAddress('ABCDEFGHJKM')).toEqual({ ok: false, error: 'dial/length' })
  })
})

describe('which addresses jojo will dial', () => {
  const dialable = (host: string) => isPrivateAddress(at(host, 8080))

  it('accepts the ranges a local network is actually built from', () => {
    for (const host of [
      '10.0.0.1',
      '10.255.255.254',
      '172.16.0.1',
      '172.31.255.254',
      '192.168.0.1',
      '192.168.255.254',
      '169.254.1.1',
      '127.0.0.1',
    ]) {
      expect(dialable(host), host).toBe(true)
    }
  })

  it('refuses everything routable', () => {
    for (const host of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '203.0.113.5', '172.15.0.1']) {
      expect(dialable(host), host).toBe(false)
    }
  })

  it('gets the 172.16/12 boundary right, which is the one that is easy to fumble', () => {
    // The mask is 12 bits, not 16 — so 172.16 through 172.31 are private and the
    // neighbours on either side are ordinary internet addresses.
    expect(dialable('172.15.255.255')).toBe(false)
    expect(dialable('172.16.0.0')).toBe(true)
    expect(dialable('172.31.255.255')).toBe(true)
    expect(dialable('172.32.0.0')).toBe(false)
    for (let b = 0; b < 256; b += 1) {
      expect(dialable(`172.${b}.0.1`), `172.${b}`).toBe(b >= 16 && b <= 31)
    }
  })

  it('refuses carrier-grade NAT, which looks private and is not', () => {
    // 100.64.0.0/10 is what an ISP puts between a customer and the internet.
    // Two devices in it share a CARRIER, not a network, and the traffic crosses
    // equipment nobody in the room owns. Admitting it would be a backup sent
    // over the internet by a rule written to keep it off.
    for (const host of ['100.64.0.1', '100.100.50.1', '100.127.255.254']) {
      expect(dialable(host), host).toBe(false)
    }
    // And the neighbours, which are ordinary public addresses either way.
    expect(dialable('100.63.255.255')).toBe(false)
    expect(dialable('100.128.0.0')).toBe(false)
  })

  it('refuses the whole public internet, checked by sweep rather than by sample', () => {
    // Every first octet, so a range cannot be admitted by a typo in a bound.
    const PRIVATE_FIRST = new Set([10, 127, 169, 172, 192])
    for (let a = 0; a < 256; a += 1) {
      if (PRIVATE_FIRST.has(a)) continue
      expect(dialable(`${a}.1.1.1`), `${a}.x`).toBe(false)
    }
    // And within the ambiguous first octets, only the right second octets.
    expect(dialable('169.253.1.1')).toBe(false)
    expect(dialable('169.255.1.1')).toBe(false)
    expect(dialable('192.167.1.1')).toBe(false)
    expect(dialable('192.169.1.1')).toBe(false)
  })
})

describe('the hint about whether two machines look reachable', () => {
  it('recognises a shared /24 and a split one', () => {
    expect(looksSameNetwork(at('192.168.1.10', 1), at('192.168.1.99', 2))).toBe(true)
    expect(looksSameNetwork(at('192.168.1.10', 1), at('192.168.2.10', 2))).toBe(false)
    expect(looksSameNetwork(at('10.0.0.1', 1), at('192.168.1.1', 2))).toBe(false)
  })
})
