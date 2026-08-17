/**
 * kgLog / kgWarn / kgError.
 *
 * Local-first means there is no telemetry endpoint and no server log, so the
 * console is the only place a dropped record can announce itself. Every
 * validation rejection and every persistence retry goes through here rather than
 * through a bare `console.log`, so they are greppable and can be silenced as a
 * group.
 *
 * The prefix is not decoration. A user reporting "it lost my Rice application"
 * is going to be asked to open the console and read out what is there, and
 * '[kg]' is what tells them which lines to read.
 */

const PREFIX = '[kg]'

let enabled = true

/** Off for the duration of a test that asserts on a failure path it expects. */
export function setKgLogging(on: boolean): void {
  enabled = on
}

export function kgLog(message: string, context?: Record<string, unknown>): void {
  if (!enabled) return
  if (context) console.log(PREFIX, message, context)
  else console.log(PREFIX, message)
}

export function kgWarn(message: string, context?: Record<string, unknown>): void {
  if (!enabled) return
  if (context) console.warn(PREFIX, message, context)
  else console.warn(PREFIX, message)
}

/**
 * Takes the error itself, not a message read off it.
 *
 * `kgError('write failed', e.message)` throws away the stack, and the stack is
 * the only part that says which store rejected the write — a `KgError` carries
 * the original DOMException as its `cause` precisely so this line can print it.
 */
export function kgError(message: string, error: unknown, context?: Record<string, unknown>): void {
  if (!enabled) return
  if (context) console.error(PREFIX, message, error, context)
  else console.error(PREFIX, message, error)
}
