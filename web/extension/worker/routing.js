/**
 * What the relays may carry: the popup's routing switches, and the one rule for
 * which model addresses a page may have this worker fetch.
 */

import { MODEL_HOSTS } from '../policy.js'
import { hostOf, isLoopback, isPrivateNetwork } from './targets.js'

/**
 * Which relays are switched on, and where the reader lives.
 *
 * Two relays leave this machine's control in different ways, so they are two
 * switches rather than one: the READER hop stays on loopback and is the private
 * option; the MODEL hop goes to a named provider on the internet and is billed.
 * Somebody who wants the reader and not the cloud can have exactly that, and
 * the popup is where they say so.
 *
 * Per PROVIDER rather than one flag for all of them, because the providers are
 * not interchangeable to the person paying: a key for one is not a key for
 * another, and "route to NVIDIA but not to OpenAI" is a real preference.
 *
 * Absent means ON for the reader and the named providers. An extension that
 * arrives switched off looks broken, and the failure — a relay that refuses —
 * reads exactly like the bug this whole file exists to work around. Defaults
 * live in `defaultRouting`.
 *
 * `network` — models on the person's own network — is the exception, and is
 * OFF until they turn it on. The other routes each go to one named place; this
 * one goes to any private address a page names, which is a page reaching the
 * person's router, printer and NAS through their browser. Nothing a page sends
 * can switch it on (a script on jojo's origin could send the same thing), so
 * only the popup can: one press, named in the refusal the first time a model on
 * the network is asked for.
 */
export const ROUTING = 'jojo.routing'

export const READER_DEFAULT = 'http://127.0.0.1:3001/mcp'

function defaultRouting() {
  return {
    reader: { enabled: true, endpoint: READER_DEFAULT },
    models: Object.fromEntries(MODEL_HOSTS.map((host) => [host, true])),
    network: false,
  }
}

export async function routing() {
  const stored = await chrome.storage.local.get(ROUTING)
  const saved = stored[ROUTING]
  const base = defaultRouting()
  if (!saved || typeof saved !== 'object') return base
  return {
    reader: {
      enabled: saved.reader?.enabled !== false,
      endpoint:
        typeof saved.reader?.endpoint === 'string' && saved.reader.endpoint.trim()
          ? saved.reader.endpoint.trim()
          : READER_DEFAULT,
    },
    // Rebuilt from MODEL_HOSTS rather than trusted wholesale, so a provider
    // added to the allowlist appears switched on instead of missing, and one
    // removed from it cannot linger in storage as a route that no longer exists.
    models: Object.fromEntries(MODEL_HOSTS.map((host) => [host, saved.models?.[host] !== false])),
    // `=== true`: absent is OFF here, unlike every switch above. See ROUTING.
    network: saved.network === true,
  }
}

/**
 * jojo-bridge's port — `DEFAULT_PORT` in `jojo-bridge.mjs`, and the one the
 * page dials (`BRIDGE_ADDRESS` in `web/src/lib/mcp-link.ts`). The link is
 * pinned to it: without a pin, `jojo:mcp-link` relayed any request to any port
 * on this machine, so a page could drive every local dev server and database
 * console the person had running.
 */
export const JOJO_BRIDGE_ADDRESS = 'http://127.0.0.1:3002'

/**
 * The loopback ports a local model server listens on out of the box: Ollama
 * 11434, LM Studio 1234, vLLM and llama-cpp-python 8000, llama.cpp's server,
 * LocalAI and TGI 8080, Jan 1337, GPT4All 4891, text-generation-webui 5000 and
 * KoboldCpp 5001.
 *
 * The model relay used to take ANY loopback port and path, which undid the
 * pinning above: a page could send `jojo:call-model` at the reader on 3001, the
 * bridge on 3002, or a dev server or database console, and get its answer
 * back. The page cannot say which ports are the person's real providers in a
 * way this worker could trust — a script on jojo's origin can send the same
 * message — so the list is fixed here. Any other loopback port is behind the
 * "Models on my network" switch, which only the popup can turn on, and the
 * reader's and bridge's ports are refused whatever the switch says.
 */
export const LOCAL_MODEL_PORTS = ['11434', '1234', '8000', '8080', '1337', '4891', '5000', '5001']

/** An http address's port, with the scheme default filled in; '' if unparseable. */
function portOf(raw) {
  try {
    const url = new URL(raw)
    return url.port === '' ? (url.protocol === 'https:' ? '443' : '80') : url.port
  } catch {
    return ''
  }
}

/**
 * A model provider jojo knows about, over https.
 *
 * Several of them send no CORS headers — measured against
 * `integrate.api.nvidia.com`, whose preflight answers 200 with `vary: Origin`
 * and no `access-control-allow-origin`, so the browser blocks the real request
 * and the page reports a bare "Failed to fetch". The extension is not a page and
 * is not subject to that.
 *
 * An allowlist rather than "any https", for the same reason `isLoopback` exists:
 * this relays a request the page composed using the extension's own permissions,
 * and without a list any script on jojo's origin could read any site on the web
 * through it. `MODEL_HOSTS` is transcribed from the provider table and the gate
 * checks the transcription.
 *
 * Exact host match, not a suffix test: `endsWith('openai.com')` also accepts
 * `evil-openai.com`, which is how allowlists usually fail.
 */
export function isKnownModelHost(raw) {
  let url
  try {
    url = new URL(raw)
  } catch {
    return false
  }
  if (url.protocol !== 'https:') return false
  return MODEL_HOSTS.includes(url.hostname)
}

/**
 * Whether this model address is refused, and why — or null to go ahead.
 *
 * ONE copy of the rule, called by both the whole-body relay and the streaming
 * one. Two copies would be two things to keep in step, and the thing they
 * decide is which addresses this extension will fetch on a page's behalf —
 * exactly the rule that must not drift.
 */
export async function modelRefusal(url) {
  const routes = await routing()
  const host = hostOf(url)
  // A provider the person switched off is refused BY NAME, so the message says
  // which one and where to change it. Loopback is not a provider and has no
  // switch of its own — it is pinned by port just below.
  if (host && !isLoopback(url) && routes.models[host] === false) {
    return `Routing to ${host} is switched off in the jojo extension.`
  }
  // Loopback is pinned too — see LOCAL_MODEL_PORTS. jojo's own reader and
  // bridge are never a model, so they are refused even with the switch on.
  if (isLoopback(url)) {
    const port = portOf(url)
    const reader = isLoopback(routes.reader.endpoint) ? portOf(routes.reader.endpoint) : ''
    if (port === portOf(READER_DEFAULT) || port === portOf(JOJO_BRIDGE_ADDRESS) || port === reader) {
      return `Port ${port} on this machine is jojo's own document reader or bridge, not a model, so the extension will not send a model request there.`
    }
    if (!LOCAL_MODEL_PORTS.includes(port) && !routes.network) {
      return (
        `Port ${port} on this machine is not one a local model server uses by default ` +
        `(${LOCAL_MODEL_PORTS.join(', ')}), so relaying to it is switched off in the jojo extension. ` +
        'Open the extension and turn on "Models on my network" to allow other ports.'
      )
    }
    return null
  }
  // A model on the person's own network, which has its own switch and is OFF
  // until they turn it on — see ROUTING. Named so the fix is one press away.
  if (isPrivateNetwork(url) && !routes.network) {
    return (
      `${host} is on your own network, and relaying to models on your network is switched off ` +
      'in the jojo extension. Open the extension and turn on "Models on my network".'
    )
  }
  if (!isLoopback(url) && !isPrivateNetwork(url) && !isKnownModelHost(url)) {
    return (
      'That address is not a model provider jojo knows about, is not on this machine, ' +
      'and is not on your own network. The extension relays to this machine, to private ' +
      'network addresses, and to the hosted providers in its own list — a plain http ' +
      'address on the public internet is refused.'
    )
  }
  return null
}
