# jojo — keep this posting

A browser extension that saves a job posting into your jojo vault, exactly as it
reads today.

It exists because a job posting is the one document in a search that belongs to
somebody else. The listing comes down the week after the interview and takes the
requirements with it — the ones you are about to be asked about.

## Why an extension and not the app

The app cannot do this, and the reason is not a missing feature.

A posting worth keeping is usually behind a login: Workday, LinkedIn, a
university portal. The session for that login lives in your browser, so the
capture has to happen **in the tab**, after the page's own JavaScript has run and
with your cookies attached. Nothing else has that view:

- The web app's own `fetch` is refused cross-origin. Measured against three real
  job boards: `TypeError: Failed to fetch`, every time. This is CORS, not a
  library choice, and there is no way around it from a page.
- A localhost helper would be no better. A server has no session either.

A content script running in the tab does have that view. That is the whole job.

## Loading it

Unpacked, from disk. There is no store listing.

**Chrome, Edge, Brave, Arc**

1. Open `chrome://extensions`
2. Turn on **Developer mode**
3. **Load unpacked** → choose this `web/extension` folder

**Firefox**

Firefox is the one browser where this could be a genuine one-click install, and
it is worth knowing why it is not yet. Mozilla still supports self-hosted
distribution: an add-on signed as **unlisted** on addons.mozilla.org — automated,
no human review, seconds — can be served from any site as
`application/x-xpinstall`, and a plain link then raises Firefox's own install
prompt. No store listing, no browsing the add-ons site. `manifest.json` already
carries the `browser_specific_settings.gecko.id` that signing requires, and the
`background` key names both a `service_worker` and a `scripts` array because
Firefox does not support the former.

What is missing is the signing step. Until it exists, load it temporarily:
`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → pick
`manifest.json`. **Firefox forgets temporary add-ons when it restarts**, so this
is for trying it out rather than for using it.

## Using it

1. Open the posting and sign in if it asks you to.
2. Click the jojo button in the toolbar. The badge shows how many captures are
   waiting.
3. Open jojo. The Vault's **Files** tool shows a strip: _"1 posting is waiting to
   be saved here."_ Press **Save it**.

If the posting's address matches an application you are already tracking, the
capture files itself under that application. Otherwise it lands in the Vault
unattached and the file row's picker attaches it in one click.

## What it keeps, and what it does not

Every stylesheet, image and font is rewritten into the page as a `data:` URI, so
a saved posting **makes no network requests when you read it back** — verified by
loading a capture with a request counter behind it and watching it stay at zero.
That matters more than it sounds: an archive that phones out is a beacon fired at
a company you may be mid-negotiation with, from an app whose whole promise is
that nothing leaves your device.

What that costs:

- `<script>`, `<iframe>`, `<object>` and inline `on…` handlers are removed.
- Links keep their text and lose their destination — the address is preserved
  beside them in `data-jojo-href` and shown, never followed. A sandbox stops a
  saved page navigating the tab; it does not stop a click navigating the frame,
  and that click would be a live request.
- Anything that cannot be inlined — an asset behind the same login, one over
  2 MB, one that fails — is dropped and **counted**. The count is on the file's
  note, so a page that looks plainer than you remember tells you why.
- A capture is capped at 8 MB.

Nothing is uploaded anywhere. The extension fetches subresources your browser
was already showing you, holds the result in `chrome.storage.local` on your own
machine, and hands it to jojo the next time you open it.

## The files

| File            | What it is                                                                        |
| --------------- | --------------------------------------------------------------------------------- |
| `manifest.json` | MV3. `host_permissions` is what lets the worker fetch subresources without CORS.  |
| `serialise.js`  | The DOM walk. Injected into the tab; collects addresses, never fetches them.      |
| `background.js` | Fetches those addresses, inlines them, sweeps anything left, queues the result.   |
| `bridge.js`     | Runs on jojo's own origin and relays between the page and the worker.             |
| `policy.js`     | What may be kept. A transcription of `service/kg/core/capture.ts`, checked below. |

`policy.js` is a hand copy, because an extension loaded from disk cannot import
from the workspace. It is not trusted to stay in step:
`web/src/lib/capture-policy.test.ts` compares it against the package's constants
and fails the build on any drift.
