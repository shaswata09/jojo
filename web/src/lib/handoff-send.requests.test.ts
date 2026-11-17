/**
 * Q129 and Q114: the computer starts a transfer by typing the code the phone's
 * receive screen shows, and nothing is sent until the handshake has produced
 * the keys.
 *
 * The code itself — that it round-trips an address, catches typos and refuses
 * a routable one — is `service/kg/core/dial.test.ts`. The handshake's security
 * is `service/kg/core/pairing.test.ts`. What neither can see is the ORDER inside
 * `useHandoffSend().start`, which is a hook (D20), so it is read as source:
 * the typed code is decoded into the phone's address, the phone is asked for
 * its half of the handshake, and chunks go out only after `complete` returned
 * keys, sealed under the key that handshake produced.
 */

import { describe, expect, it } from 'vitest'
import sendSource from './handoff-send.ts?raw'
import connectSource from '@/components/transfer-ui/ConnectPanel.tsx?raw'
import receiveSource from '../../../mobile/src/components/transfer/ReceivePanel.tsx?raw'
import transferCatalog from '@/i18n/locales/en/transfer.json'

const strip = (source: string) =>
  source
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')

const code = strip(sendSource)
const start = code.slice(code.indexOf('const start = useCallback('))

/** Index of `needle` in `start`, failing loudly when it is missing. */
const at = (needle: string) => {
  const i = start.indexOf(needle)
  expect(i, needle).toBeGreaterThan(-1)
  return i
}

describe('starting a transfer from the code the phone shows (Q129)', () => {
  it('shows the code on the phone’s receive screen, built from its own address', () => {
    expect(strip(receiveSource)).toContain('{groupCode(encodeAddress(session.address))}')
  })

  it('takes the typed code on the computer and starts the send with it', () => {
    const connect = strip(connectSource)
    expect(connect).toContain("aria-label={t('connect.codeLabel')}")
    expect(transferCatalog.connect.codeLabel).toBe('The code shown on your phone')
    expect(connect).toContain('void send.start(code, tokens)')
  })

  it('dials the address the code decodes to, and asks that phone for the handshake', () => {
    const decoded = at('const read = decodeAddress(code)')
    const asked = at('await fetchPairingResponse(address, token, mine.signal)')
    expect(asked).toBeGreaterThan(decoded)
    // A code that does not decode stops the run before anything is dialled.
    expect(start.slice(decoded, asked)).toMatch(/if \(!read\.ok\) \{[\s\S]*?return\s*\}/)
  })
})

describe('nothing moves before the handshake has passed the key (Q114)', () => {
  it('sends chunks only after complete() has produced keys', () => {
    const asked = at('await fetchPairingResponse(address, token, mine.signal)')
    const keyed = at('const keys = await complete(response.value, token)')
    const refused = at('if (keys === null) {')
    const sealed = at('planConvoy(secrets, keys.offererToAnswerer, payload)')
    const sent = at('await sendChunk(address, token, await plan.seal(seq), mine.signal)')
    expect(keyed).toBeGreaterThan(asked)
    expect(refused).toBeGreaterThan(keyed)
    expect(sealed).toBeGreaterThan(refused)
    expect(sent).toBeGreaterThan(sealed)
    // The refusal returns: a failed handshake cannot fall through to the send.
    expect(start.slice(refused, sealed)).toMatch(/setStage\('failed'\)\s*return/)
  })

  it('stops on a handshake the phone did not answer, before any chunk', () => {
    const asked = at('await fetchPairingResponse(address, token, mine.signal)')
    const keyed = at('const keys = await complete(response.value, token)')
    expect(start.slice(asked, keyed)).toContain('if (!response.ok) return stop(response.error)')
  })
})
