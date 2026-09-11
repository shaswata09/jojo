/**
 * Types for `jojo-bridge.mjs`, which is plain JavaScript so it can be fetched
 * and run with nothing but `node`. Only the tests import it.
 *
 * The request and response are `unknown` rather than `node:http`'s types:
 * web's `tsc -b` has no Node types, and the tests hand the handler the objects
 * a real `node:http` server gives it.
 */

export const DEFAULT_PORT: number
export const POLL_MS: number
export const ATTACH_WAIT_MS: number
export const REPLY_WAIT_MS: number

export function tokenMatches(expected: string, header: string | undefined): boolean
export function isLoopbackHost(host: string | undefined, port: number): boolean
export function isLoopbackOrigin(origin: string | undefined): boolean

export function createBridge(options: {
  token: string
  port?: number
  pollMs?: number
  attachWaitMs?: number
  replyWaitMs?: number
  log?: (line: string) => void
}): {
  handle: (req: unknown, res: unknown) => void
  state: () => { attached: boolean; polling: boolean; queued: number; inflight: number }
}
