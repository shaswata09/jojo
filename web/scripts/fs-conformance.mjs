/**
 * Runs the `FileStore` conformance suite against the File System Access adapter.
 *
 *   npm -w web run dev            # in one terminal
 *   node scripts/fs-conformance.mjs
 *
 * Not part of `gate.sh`, and that is deliberate rather than an oversight: this
 * needs a real Chromium and a running dev server, neither of which a unit-test
 * gate should assume. `memory-file-store.test.ts` runs the same 23 cases in
 * Vitest on every gate; this is what stops the OTHER implementation — the one
 * that actually holds the user's documents — from being the one with no
 * contract test.
 *
 * The page it drives (`conformance/fs-conformance.html`) backs the adapter with
 * an OPFS directory rather than a picked one. `showDirectoryPicker` needs a user
 * gesture and opens a native dialog CDP cannot drive; `navigator.storage
 * .getDirectory()` hands back the same `FileSystemDirectoryHandle` interface
 * with neither. The adapter is written against the handle for exactly that
 * reason.
 *
 * Exits non-zero on any failing case, so CI can run it once a browser is
 * available.
 */

import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'

const BASE = process.env.CONFORMANCE_URL ?? 'http://localhost:4200'
const PAGE = `${BASE}/conformance/fs-conformance.html`
const PORT = Number(process.env.CDP_PORT ?? 9899)
const CHROME =
  process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function reachable(url) {
  try {
    const res = await fetch(url)
    return res.ok
  } catch {
    return false
  }
}

if (!(await reachable(PAGE))) {
  console.error(`fs-conformance: nothing serving ${PAGE}`)
  console.error('Start the dev server first:  npm -w web run dev')
  process.exit(2)
}

const profile = mkdtempSync(join(tmpdir(), 'jojo-conformance-'))
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--enable-gpu',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    'about:blank',
  ],
  { stdio: 'ignore' },
)

/**
 * Kill only the browser this script started, by pid — never by name.
 *
 * Best effort, and deliberately silent. `kill` is asynchronous: Chrome is often
 * still flushing its profile when this runs, so removing the directory threw
 * ENOTEMPTY *after* the results had printed — which turned a passing run into a
 * crash and an exit code that said the contract had been broken when it had not.
 * A leftover directory under the OS temp dir is not worth reporting, let alone
 * worth failing a run over.
 */
const cleanup = () => {
  try {
    chrome.kill()
  } catch {
    /* already gone */
  }
  try {
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  } catch {
    /* Chrome still had it open; the OS will reap it */
  }
}
process.on('exit', cleanup)
process.on('SIGINT', () => process.exit(130))

let version = null
for (let i = 0; i < 40 && version === null; i++) {
  try {
    version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()
  } catch {
    await sleep(250)
  }
}
if (version === null) {
  console.error('fs-conformance: Chrome never opened a debugging port')
  process.exit(2)
}

const target = await (
  await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })
).json()
const ws = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
const pageErrors = []

ws.on('message', (raw) => {
  const msg = JSON.parse(raw)
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg)
    pending.delete(msg.id)
  }
  if (msg.method === 'Runtime.exceptionThrown') {
    pageErrors.push(msg.params.exceptionDetails.text)
  }
})
await new Promise((r) => ws.on('open', r))

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const id = ++nextId
    pending.set(id, resolve)
    ws.send(JSON.stringify({ id, method, params }))
  })

const evaluate = async (expression) =>
  (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result
    ?.result?.value

await send('Page.enable')
await send('Runtime.enable')
// Cache-busted, so a rerun after an edit does not grade the previous bundle.
await send('Page.navigate', { url: `${PAGE}?t=${Date.now()}` })

let done = false
for (let i = 0; i < 120 && !done; i++) {
  done = (await evaluate('globalThis.__conformanceDone === true')) === true
  if (!done) await sleep(500)
}

const raw = await evaluate('JSON.stringify(globalThis.__conformance ?? null)')
if (!done || !raw || raw === 'null') {
  console.error('fs-conformance: the suite never reported')
  for (const e of pageErrors.slice(0, 5)) console.error(`  ${e}`)
  process.exit(1)
}

const results = JSON.parse(raw)
const failed = results.filter((r) => !r.ok)
for (const f of failed) console.error(`FAIL  ${f.name}\n      ${f.error}`)
console.log(`fs-conformance: ${results.length - failed.length}/${results.length} cases pass`)
process.exit(failed.length === 0 ? 0 : 1)
