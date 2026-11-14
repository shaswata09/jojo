/** The worker's own crash log, kept only when the person has switched it on. */

import { reasonOf } from './util.js'

/** Where the crash-reporting choice and the worker's own crash log live. */
const CRASH_ON = 'jojo.crash.on'
const CRASH_LOG = 'jojo.crash.log'
/** Enough to see a pattern, too few to grow without end. */
const CRASH_LOG_MAX = 20

/**
 * One handler failure, kept only when the person has crash reporting on —
 * the default is off, and this records nothing until they say otherwise. What
 * is kept is the verb and the message: never a URL, a body or a page.
 */
export async function recordCrash(verb, error) {
  try {
    const stored = await chrome.storage.local.get([CRASH_ON, CRASH_LOG])
    if (stored[CRASH_ON] !== true) return
    const log = Array.isArray(stored[CRASH_LOG]) ? stored[CRASH_LOG] : []
    log.push({ at: new Date().toISOString(), verb: String(verb ?? ''), message: reasonOf(error).slice(0, 300) })
    await chrome.storage.local.set({ [CRASH_LOG]: log.slice(-CRASH_LOG_MAX) })
  } catch {
    // A crash log that crashes has nothing left to report to.
  }
}

/*
 * The crash-reporting choice, which `bridge.js` has forwarded since protocol 4
 * and nothing here answered — so the verb fell through to `return false` and
 * every caller got "message port closed". The page owns the choice and pushes
 * it; this keeps it, clears the log when asked, and hands back what it has.
 */
export async function onCrashReporting(message, sendResponse) {
  const stored = await chrome.storage.local.get([CRASH_ON, CRASH_LOG])
  const on = typeof message.on === 'boolean' ? message.on : stored[CRASH_ON] === true
  const kept = message.clear === true || !on ? [] : (Array.isArray(stored[CRASH_LOG]) ? stored[CRASH_LOG] : [])
  await chrome.storage.local.set({ [CRASH_ON]: on, [CRASH_LOG]: kept })
  sendResponse({ on, crashes: kept })
}
