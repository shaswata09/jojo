/**
 * Everything the receiving phone does between "code scanned" and "records in".
 *
 * The pieces each have a home — `core/pairing.ts` agrees the key, `core/handoff.ts`
 * parses requests, `core/convoy.ts` decrypts the stream, `handoff-server.ts`
 * binds the socket. This is the order they go in, which is the part that would
 * otherwise be spread across a component.
 *
 * ## Why the address is found rather than assumed
 *
 * `react-native-tcp-socket` will happily bind a port and cannot say what address
 * that port is reachable at — the socket knows it bound `0.0.0.0`, which is true
 * and useless to the other device. So the wifi address comes from NetInfo, which
 * is why `ACCESS_NETWORK_STATE` and `ACCESS_WIFI_STATE` had to come back into
 * the manifest; see the note there.
 *
 * A phone on cellular has no local address, and one on a network jojo will not
 * dial has an address `core/dial.ts` refuses. Both are reported here rather than
 * discovered as a connection that never arrives.
 */

import NetInfo from '@react-native-community/netinfo'
import { createConvoyReceiver } from '@jojo/service/core/convoy'
import { isPrivateAddress, type DialAddress } from '@jojo/service/core/dial'
import { pathToken } from '@jojo/service/core/handoff'
import { acceptPairing, type PairingOffer, type SessionKeys } from '@jojo/service/core/pairing'
import { decodeOffer } from '@jojo/service/core/pairing'
import { createSecrets } from '@jojo/service/crypto/noble-secrets'
import { startHandoffServer, type HandoffServer } from '@/lib/handoff-server'

export type ReceiveProblem =
  /** The scanned code was not a pairing offer this build understands. */
  | 'receive/offer'
  /** No local network address — cellular only, or wifi is off. */
  | 'receive/no-network'
  /** On a network, at an address jojo will not dial. */
  | 'receive/not-local'
  /** The socket would not bind. */
  | 'receive/no-socket'

export type ReceiveSession = {
  /** Where the other device should connect. */
  address: DialAddress
  /** What the other device is about to receive, once it asks. */
  keys: SessionKeys
  /** Bytes accepted so far, for a progress readout. */
  progress: () => { bytes: number; complete: boolean }
  /** The transferred payload, once the final chunk has authenticated. */
  payload: () => Uint8Array | null
  stop: () => void
}

export type ReceiveResult =
  | { ok: true; value: ReceiveSession }
  | { ok: false; error: ReceiveProblem }

/** This device's address on the local network, or why there is not one. */
async function localAddress(port: number): Promise<ReceiveResult | DialAddress> {
  const state = await NetInfo.fetch()
  const ip = (state.details as { ipAddress?: string } | null)?.ipAddress
  if (typeof ip !== 'string' || ip.length === 0) {
    return { ok: false, error: 'receive/no-network' }
  }

  const octets = ip.split('.').map(Number)
  if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // An IPv6 address, or something unparseable. Not a failure of the phone —
    // `dial.ts` carries IPv4 because that is what a LAN hands out and what fits
    // in a code somebody types.
    return { ok: false, error: 'receive/not-local' }
  }

  const address: DialAddress = {
    host: [octets[0]!, octets[1]!, octets[2]!, octets[3]!],
    port,
  }
  // The same rule the sending device applies, applied here too — so a phone on a
  // network jojo would refuse to dial says so now, rather than showing a code
  // that the other device will reject.
  if (!isPrivateAddress(address)) return { ok: false, error: 'receive/not-local' }
  return address
}

/**
 * Accepts a scanned offer, opens a socket, and stands ready.
 *
 * Everything after this is driven by the other device: it asks for the pairing
 * response, then posts chunks. Nothing here initiates.
 */
export async function beginReceiving(offerBytes: Uint8Array): Promise<ReceiveResult> {
  const read = decodeOffer(offerBytes)
  if (!read.ok) return { ok: false, error: 'receive/offer' }
  const offer: PairingOffer = read.value

  const secrets = createSecrets()
  const accepted = await acceptPairing(secrets, offerBytes)
  if (!accepted.ok) return { ok: false, error: 'receive/offer' }

  const token = await pathToken(secrets, offer)
  const convoy = createConvoyReceiver(secrets, accepted.value.keys.offererToAnswerer)

  let server: HandoffServer
  try {
    server = await startHandoffServer(token, async (request) => {
      // A preflight is the browser asking permission of itself. There is nothing
      // to decide and nothing to return.
      if (request.route === 'preflight') return { status: 204 }

      // The response proves this device read the screen. It is not a secret —
      // it is useless to anything that did not — so it goes out in the clear.
      if (request.route === 'pair') return { status: 200, body: accepted.value.response }

      const outcome = await convoy.accept(request.body)
      // 409 rather than 400: the chunk was well-formed and did not belong here.
      // The sender's correct response is to stop, not to resend.
      return { status: outcome === 'rejected' ? 409 : 200 }
    })
  } catch {
    return { ok: false, error: 'receive/no-socket' }
  }

  const address = await localAddress(server.port)
  if (!('host' in address)) {
    // Nothing can reach this port, so nothing should be listening on it.
    server.stop()
    return address
  }

  return {
    ok: true,
    value: {
      address,
      keys: accepted.value.keys,
      progress: () => {
        const at = convoy.progress()
        return { bytes: at.bytes, complete: at.complete }
      },
      payload: () => convoy.payload(),
      stop: server.stop,
    },
  }
}

/** What to tell the person, per failure. */
export const RECEIVE_ADVICE: Record<ReceiveProblem, string> = {
  'receive/offer': 'That code is not a jojo pairing offer. Scan the one on your other device.',
  'receive/no-network':
    'This phone is not on a wifi network. jojo transfers over your local network only, so both devices need to be on the same wifi.',
  'receive/not-local':
    'This phone is on a network jojo will not transfer over. It only connects to a private network address, so your records never cross the internet.',
  'receive/no-socket': 'jojo could not open a connection on this phone. Try again.',
}
