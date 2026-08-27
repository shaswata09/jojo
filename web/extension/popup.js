/**
 * The toolbar panel: keep a page, see what is kept, and decide what this
 * extension is allowed to carry.
 *
 * ## Why the action has a popup at all
 *
 * Clicking the icon used to capture the page immediately, with a badge as the
 * only feedback. That is a fine shortcut and a poor interface: the queue was
 * invisible, a page kept by accident could not be removed, and the two relays —
 * the document reader and the model providers — were switched on permanently
 * with nothing anywhere to say so, let alone turn them off. All three of those
 * are questions about the EXTENSION rather than about a page, so they belong to
 * the extension's own surface.
 *
 * ## What this file may and may not do
 *
 * It holds no capture data and does no fetching. Every button here sends a
 * message to the service worker and draws what comes back, because the worker
 * is where the queue, the allowlist and the relays already live — and because a
 * popup is destroyed the moment it loses focus, so anything it owned would be
 * lost mid-operation.
 *
 * The verbs it uses are answered only for the extension's own pages
 * (`fromOwnPage` in `background.js`). They are more powerful than the ones the
 * web app gets and are not reachable from a page.
 */

const $ = (id) => document.getElementById(id)

/** One round trip to the worker. Rejects rather than resolving undefined. */
const ask = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const failed = chrome.runtime.lastError
      if (failed) reject(new Error(failed.message))
      else resolve(response ?? {})
    })
  })

/* -------------------------------------------------------------- formatting */

/** '1.2 MB', '840 KB'. Sizes here run from a few KB to a few MB. */
function size(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/**
 * 'just now', '12 min ago', '3 hours ago', then a date.
 *
 * Relative while it is useful and absolute once it is not: "kept 4 days ago" is
 * a worse answer than the date, and a queue is meant to be emptied long before
 * it gets there.
 */
function when(iso) {
  const at = Date.parse(iso)
  if (Number.isNaN(at)) return ''
  const mins = Math.floor((Date.now() - at) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return new Date(at).toLocaleDateString()
}

/** The readable half of an address: host plus a trimmed path. */
function shortUrl(url) {
  try {
    const parsed = new URL(url)
    const path = parsed.pathname === '/' ? '' : parsed.pathname
    const whole = parsed.hostname + path
    return whole.length > 46 ? `${whole.slice(0, 45)}…` : whole
  } catch {
    return url
  }
}

/* ------------------------------------------------------------ current page */

/**
 * The tab the popup was opened over.
 *
 * A page the extension cannot script — `chrome://`, the Web Store, a PDF — is
 * shown with the button disabled and a reason, rather than being offered and
 * failing. `executeScript` rejects on those, and a button that reports a
 * failure the popup could have predicted is a button that wasted a click.
 */
async function currentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (!tab || typeof tab.id !== 'number') return null
  const url = tab.url ?? ''
  const scriptable = /^https?:\/\//i.test(url)
  return { id: tab.id, title: tab.title ?? url, url, scriptable }
}

/**
 * The tab this popup was opened over, once `drawTab` has found it.
 *
 * Module scope rather than a local the capture handler closes over, because
 * that handler is now attached before anything is drawn — see `start` — so at
 * the moment of wiring there is no tab to capture yet. It is read at click time
 * instead, and a null reaches the worker as a missing `tabId`, which already
 * answers 'No page to capture.' rather than acting on the wrong tab.
 */
let openTab = null

async function drawTab() {
  openTab = await currentTab()
  const button = $('capture')
  if (!openTab) {
    $('tab-title').textContent = 'No page here'
    $('capture-note').textContent = ''
    return
  }
  $('tab-title').textContent = openTab.title || shortUrl(openTab.url)
  $('tab-url').textContent = shortUrl(openTab.url)
  button.disabled = !openTab.scriptable
  $('capture-note').textContent = openTab.scriptable
    ? ''
    : 'This kind of page cannot be kept — browsers do not let an extension read it.'
}

/* -------------------------------------------------------------- kept pages */

async function drawKept() {
  const { captures = [] } = await ask({ type: 'jojo:list-captures' })
  const list = $('kept')
  const empty = $('kept-empty')
  list.textContent = ''
  empty.hidden = captures.length > 0
  $('clear').hidden = captures.length === 0

  // Newest first: the thing just kept is the thing being looked for.
  for (const capture of [...captures].reverse()) {
    const row = document.createElement('li')

    const who = document.createElement('div')
    who.className = 'who'
    const title = document.createElement('span')
    title.className = 't'
    title.textContent = capture.title || shortUrl(capture.url)
    const meta = document.createElement('span')
    meta.className = 'm'
    meta.textContent = [shortUrl(capture.url), when(capture.capturedAt), size(capture.bytes)]
      .filter(Boolean)
      .join(' · ')
    who.append(title, meta)

    const remove = document.createElement('button')
    remove.className = 'del'
    remove.type = 'button'
    remove.textContent = '×'
    // The title is the accessible name too — an icon-only control with a bare
    // '×' announces as "times" and nothing else.
    remove.title = `Delete ${capture.title || capture.url}`
    remove.setAttribute('aria-label', remove.title)
    remove.addEventListener('click', async () => {
      remove.disabled = true
      await ask({ type: 'jojo:delete-capture', id: capture.id })
      await drawKept()
    })

    row.append(who, remove)
    list.append(row)
  }
}

/* ----------------------------------------------------------------- routing */

function readerDot(state, text) {
  const status = $('reader-status')
  status.textContent = ''
  const dot = document.createElement('span')
  dot.className = `dot ${state}`
  status.append(dot, document.createTextNode(text))
}

async function drawRouting() {
  const { routing, hosts = [] } = await ask({ type: 'jojo:get-routing' })
  $('reader-on').checked = routing.reader.enabled
  $('reader-endpoint').value = routing.reader.endpoint
  $('reader-endpoint').disabled = !routing.reader.enabled
  $('reader-test').disabled = !routing.reader.enabled
  if (!routing.reader.enabled) readerDot('idle', 'Switched off')

  const list = $('models')
  list.textContent = ''
  for (const host of hosts) {
    const row = document.createElement('li')

    const who = document.createElement('div')
    who.className = 'who'
    const label = document.createElement('span')
    label.className = 'label'
    label.textContent = PROVIDER_NAMES[host] ?? host
    const addr = document.createElement('span')
    addr.className = 'host m mono'
    addr.textContent = host
    addr.style.color = '#a1a1a1'
    addr.style.fontSize = '10.5px'
    who.append(label, addr)

    const toggle = document.createElement('label')
    toggle.className = 'switch'
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.checked = routing.models[host] !== false
    input.setAttribute('aria-label', `Route to ${PROVIDER_NAMES[host] ?? host}`)
    const track = document.createElement('span')
    track.className = 'track'
    track.setAttribute('aria-hidden', 'true')
    input.addEventListener('change', async () => {
      await ask({ type: 'jojo:set-routing', models: { [host]: input.checked } })
    })
    toggle.append(input, track)

    row.append(who, toggle)
    list.append(row)
  }
}

/**
 * The names people recognise, beside the hosts the code checks.
 *
 * The allowlist is a list of hostnames because that is what a URL can be
 * compared against; nobody thinks of their account as
 * `integrate.api.nvidia.com`. Both are shown — the name to find the row, the
 * host so it is clear exactly what is being switched.
 */
const PROVIDER_NAMES = {
  'api.anthropic.com': 'Anthropic',
  'api.openai.com': 'OpenAI',
  'openrouter.ai': 'OpenRouter',
  'api.groq.com': 'Groq',
  'integrate.api.nvidia.com': 'NVIDIA',
}

/* -------------------------------------------------------------------- wire */

async function probeReader() {
  readerDot('busy', 'Checking…')
  $('reader-test').disabled = true
  try {
    const answer = await ask({
      type: 'jojo:probe-reader',
      endpoint: $('reader-endpoint').value,
    })
    if (answer.ok) readerDot('ok', 'Answering')
    else readerDot('bad', answer.reason ?? `No answer (${String(answer.status ?? 0)})`)
  } catch (error) {
    readerDot('bad', error instanceof Error ? error.message : String(error))
  } finally {
    $('reader-test').disabled = !$('reader-on').checked
  }
}

/**
 * Draw one region of the popup, and put the reason in that region when it
 * cannot be drawn.
 *
 * One `try` around all three would mean a reply lost for the kept list also
 * blanked the routing switches, which are a separate question answered by a
 * separate message. A popup that got two answers out of three should show the
 * two it has and say what happened to the third.
 */
async function draw(paint, say) {
  try {
    await paint()
  } catch (error) {
    say(error instanceof Error ? error.message : String(error))
  }
}

async function start() {
  $('version').textContent = `extension ${chrome.runtime.getManifest().version}`

  /*
   * Everything is wired BEFORE anything is drawn, and that order is the point.
   *
   * Waking an MV3 service worker is racy — `bridge.js` documents the same state
   * on its own send and treats it as normal — so any message from here can come
   * back as a `lastError` instead of an answer. With the listeners attached
   * after the opening draws, one lost reply rejected `start()`, the rejection
   * went nowhere (`void start()`), and the popup opened looking finished and
   * entirely dead: 'Keep this page' enabled by `drawTab` and attached to
   * nothing, 'Delete all' hidden, both switches inert, 'Nothing kept yet' over
   * a queue nobody had read. Nothing below needs drawn state in order to
   * attach, so nothing below waits for it.
   */
  $('capture').addEventListener('click', async () => {
    const button = $('capture')
    button.disabled = true
    $('capture-note').textContent = 'Keeping…'
    /*
     * `finally`, because the re-enable used to sit after an unguarded
     * `await drawKept()`.
     *
     * `drawKept` asks the worker too, and the whole reason this listener is
     * attached before the first draw is that the worker may be asleep and not
     * answer. So in exactly the failure mode being defended against, the draw
     * rejected, the async listener rejected with it, and `button.disabled =
     * false` was never reached — leaving the popup's primary control dead until
     * it was closed and reopened.
     *
     * The draw is inside the guard as well: a queue it could not read is worth
     * saying so about, and it is not worth losing the button over.
     */
    try {
      const answer = await ask({ type: 'jojo:capture-tab', tabId: openTab?.id })
      $('capture-note').textContent = answer.ok ? 'Kept.' : (answer.reason ?? 'Could not keep it.')
      await drawKept()
    } catch (error) {
      $('capture-note').textContent = error instanceof Error ? error.message : String(error)
    } finally {
      button.disabled = false
    }
  })

  $('clear').addEventListener('click', async () => {
    await ask({ type: 'jojo:clear-captures' })
    await drawKept()
  })

  $('reader-on').addEventListener('change', async () => {
    const on = $('reader-on').checked
    await ask({ type: 'jojo:set-routing', reader: { enabled: on } })
    $('reader-endpoint').disabled = !on
    $('reader-test').disabled = !on
    if (on) await probeReader()
    else readerDot('idle', 'Switched off')
  })

  // On blur rather than on every keystroke: this writes to storage, and a
  // half-typed address saved letter by letter is a stream of addresses that
  // never existed.
  $('reader-endpoint').addEventListener('change', async () => {
    await ask({ type: 'jojo:set-routing', reader: { endpoint: $('reader-endpoint').value } })
    await probeReader()
  })

  $('reader-test').addEventListener('click', probeReader)

  await draw(drawTab, (why) => {
    $('tab-title').textContent = 'Could not read this tab'
    $('capture-note').textContent = why
  })

  await draw(drawKept, (why) => {
    // Deliberately not the 'Nothing kept yet' the markup starts with: the queue
    // lives in the worker, and a worker that did not answer has said nothing
    // about whether it is empty. 'Empty' is the one answer that is actively
    // wrong here, because it reads as "your capture did not save".
    $('kept-empty').hidden = false
    $('kept-empty').textContent = `Could not read the kept pages — ${why}`
  })

  // The dot is the only place routing has to say anything, and an unread
  // setting must not look like a setting that is switched off.
  await draw(drawRouting, (why) => readerDot('bad', `Could not read the settings — ${why}`))

  // Probed on open, so the dot means something before anything is pressed. The
  // popup is short-lived, so this is the only automatic check there is.
  if ($('reader-on').checked) void probeReader()
}

/*
 * `start` reports each region's own failure in that region, so a rejection that
 * gets this far came from outside all three — and the alternative to catching
 * it is a popup that draws nothing and explains nothing.
 */
void start().catch((error) => {
  $('capture-note').textContent = error instanceof Error ? error.message : String(error)
})
