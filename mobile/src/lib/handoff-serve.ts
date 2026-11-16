/**
 * Everything the sending phone does between "code scanned" and "records handed
 * over" — phone to computer.
 *
 * ## How a phone sends to a browser that cannot be connected to
 *
 * It does not connect. It listens, exactly as it does to receive, and the
 * computer connects to it and ASKS for the phone's backup, one sealed chunk per
 * request (`core/handoff-pull.ts`). So this file is `handoff-receive.ts` with
 * the stream turned round: the same scan, the same pairing, the same socket and
 * the same address rule — and a server that answers pull requests instead of
 * accepting chunks.
 *
 * ## What it checks before handing anything over
 *
 * Three things, in order. The request's path carries this session's token, or
 * the parser refuses it (`core/handoff.ts`, which in this direction also refuses
 * any attempt to POST chunks here). The body is exactly one pull request. And
 * it carries a proof only the computer that showed the animation can make. The
 * backup is not even gathered until a request has passed all three.
 *
 * ## What is NOT proved on a device yet
 *
 * The socket, NetInfo and the file reads below need a phone, a network and a
 * computer. The protocol they carry is tested in `@jojo/service`; this is the
 * binding, kept as thin as `handoff-receive.ts` is.
 */

import ReactNativeBlobUtil from 'react-native-blob-util'
import { pathToken } from '@jojo/service/core/handoff'
import { createPullServer, type PullServing } from '@jojo/service/core/handoff-pull'
import { acceptPairing, decodeOffer } from '@jojo/service/core/pairing'
import type { DialAddress } from '@jojo/service/core/dial'
import type { Instant } from '@jojo/service/core/model'
import { canPair, createSecrets } from '@jojo/service/crypto/noble-secrets'
import { handedOver } from '@jojo/service/repo/meta'
import type { Repository } from '@jojo/service/repo/repository'
import { bytesFromBase64 } from '@/lib/base64'
import { startHandoffServer, type HandoffServer } from '@/lib/handoff-server'
import { localAddress, type ReceiveProblem } from '@/lib/handoff-receive'

/**
 * Whether this phone can pair at all — asked before the camera is.
 *
 * Here rather than in the panel because a screen may not reach the crypto
 * layer (`check-layers`); the receive panel predates that rule.
 */
export const canServe = (): boolean => canPair()

/**
 * Records that this phone handed its records over, once the last chunk went.
 *
 * On this device, as the computer stamps its own when IT sends: `handoverAt`
 * is a fact about each store, and it is what lets each one say how far it has
 * drifted since.
 */
export function stampSent(repo: Repository, at: string): void {
  repo.setMeta(handedOver(repo.meta, at as Instant))
}

export type ServeSession = {
  /** Where the computer should connect. */
  address: DialAddress
  /** How much has been handed over, for the screen. */
  progress: () => PullServing
  stop: () => void
}

export type ServeResult = { ok: true; value: ServeSession } | { ok: false; error: ReceiveProblem }

/**
 * Accepts a scanned offer, opens a socket, and waits to be asked.
 *
 * `build` gathers the backup. It runs once, on the first request that proves
 * itself — not now, so a phone that is never dialled reads nothing.
 */
export async function beginServing(
  offerBytes: Uint8Array,
  build: () => Promise<Uint8Array>,
): Promise<ServeResult> {
  const read = decodeOffer(offerBytes)
  if (!read.ok) return { ok: false, error: 'receive/offer' }

  const secrets = createSecrets()
  const accepted = await acceptPairing(secrets, offerBytes)
  if (!accepted.ok) return { ok: false, error: 'receive/offer' }

  const token = await pathToken(secrets, read.value, 'pull')
  const pull = createPullServer(secrets, accepted.value.keys, build)

  let server: HandoffServer
  try {
    server = await startHandoffServer(
      token,
      async (request) => {
        if (request.route === 'preflight') return { status: 204 }
        // The proof this phone read the computer's screen. Useless to anything
        // that did not see it, so it goes out in the clear, as when receiving.
        if (request.route === 'pair') return { status: 200, body: accepted.value.response }
        if (request.route === 'pull') return pull.answer(request.body)
        // The parser refuses chunks in this direction; this is the belt to it.
        return { status: 404 }
      },
      'pull',
    )
  } catch {
    return { ok: false, error: 'receive/no-socket' }
  }

  const address = await localAddress(server.port)
  if (!('host' in address)) {
    server.stop()
    return address
  }

  return { ok: true, value: { address, progress: pull.progress, stop: server.stop } }
}

/**
 * A stored document's bytes, or null.
 *
 * The record keeps a percent-encoded `file://` URI and the file system takes a
 * path — the decode `lib/documents.ts` does for the same reason, or a document
 * with a space in its name reads as missing.
 */
export async function readStoredDocument(uri: string): Promise<Uint8Array | null> {
  const path = uri.startsWith('file://') ? decodeURIComponent(uri.slice('file://'.length)) : uri
  try {
    if (!(await ReactNativeBlobUtil.fs.exists(path))) return null
    return bytesFromBase64(await ReactNativeBlobUtil.fs.readFile(path, 'base64'))
  } catch {
    return null
  }
}
