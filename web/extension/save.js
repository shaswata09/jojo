/**
 * Downloads one kept page as a single self-contained HTML file.
 *
 * Opened by the popup's Save button as `save.html#<capture id>`. It exists as a
 * separate page — rather than the popup downloading directly — because the
 * popup cannot keep a download alive: see the comment in `save.html`.
 *
 * The file needs nothing but itself. `inline()` in `background.js` already
 * turned every stylesheet into a `<style>` block and every image and font into
 * a `data:` URI, so it opens in any browser with no connection — measured with
 * the origin server stopped: styles applied, every image drawn, zero requests.
 *
 * How the file is shaped — doctype, provenance comment, filename — is in
 * `save-file.js`, which has no side effects so a test can check it.
 */
import { asFile, fileNameFor } from './save-file.js'

const $ = (id) => document.getElementById(id)

const ask = (message) =>
  new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const failed = chrome.runtime.lastError
      if (failed) reject(new Error(failed.message))
      else resolve(response ?? {})
    })
  })

/**
 * Hands the file to the browser's own download — no `downloads` permission
 * needed, measured. The object URL is kept for a minute rather than revoked at
 * once: a synchronous revoke races the download the click just started and the
 * file arrives empty, and this tab is still open, so there is no hurry.
 */
function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function start() {
  const id = decodeURIComponent(location.hash.slice(1))
  if (!id) {
    $('save-title').textContent = 'No page was named'
    $('save-note').textContent = 'Open this from Save on a kept page in the jojo popup.'
    return
  }

  let kept
  try {
    kept = await ask({ type: 'jojo:get-capture', id })
  } catch (error) {
    $('save-title').textContent = 'Could not reach the extension'
    $('save-note').textContent = error instanceof Error ? error.message : String(error)
    return
  }
  if (!kept.ok) {
    $('save-title').textContent = 'That page is no longer kept'
    $('save-note').textContent = kept.reason ?? 'It may have been filed into jojo or deleted.'
    return
  }

  const name = fileNameFor(kept)
  const text = asFile(kept)
  $('save-title').textContent = kept.title || kept.url
  $('save-url').textContent = kept.url
  document.title = `Saved ${name} — jojo`

  download(text, name)
  $('save-note').textContent =
    `Saved as ${name}. It opens in any browser with no connection, long after the original ` +
    'page has gone. You can close this tab.'
  // A real click, for a browser set to ask before every download or one that
  // blocked the automatic one.
  $('save-again').hidden = false
  $('save-again').addEventListener('click', () => {
    download(text, name)
  })
}

void start()
