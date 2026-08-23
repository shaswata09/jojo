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

You do not need a checkout of this repository. **Settings → Keeping postings**
has a download button, and every tagged release carries `jojo-extension.zip` as
an attachment. Unzip it and the `jojo-extension` folder is what the steps below
call "this `web/extension` folder" — the zip is that folder, packed by
`web/scripts/pack-extension.mjs`.

**Chrome, Edge, Brave, Arc**

1. Open `chrome://extensions` (Brave: `brave://extensions`, Edge: `edge://extensions`) — paste it
   into the address bar, because a web page is not allowed to link to a `chrome://` URL
2. Turn on **Developer mode**, top right
3. **Load unpacked** → choose this `web/extension` folder
4. **Pin it**: click the jigsaw-piece button in the toolbar and pin jojo. Chromium hides every
   extension behind that menu by default, so without this the button exists and is invisible —
   which looks exactly like a failed install

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
   waiting — on that tab. It is per-tab, so it disappears when you close the
   posting; the count that matters is the one in jojo's Vault.
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
- Links keep their text and lose their destination. The address is preserved
  beside them in a `data-jojo-href` attribute — present in the saved file, so it
  survives an export and can be read there, but nothing in the viewer renders it
  yet. A sandbox stops a saved page navigating the tab; it does not stop a click
  navigating the frame, and that click would be a live request.
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
| `harvest.js`    | The link sweep on a job board. Injected into a background tab; judges nothing.    |
| `icons/`        | Four PNGs, 16 to 128. Generated — see below — never edited by hand.               |

The icons are drawn by `web/scripts/make-extension-icons.mjs`, which runs before
every pack. They are jojo's robot head — the same mark as the browser tab's
favicon, with the geometry converted from `web/public/favicon.svg`'s own viewBox
rather than redrawn by eye. Editing the PNGs directly is pointless: the next
build overwrites them.

`policy.js` is a hand copy, because an extension loaded from disk cannot import
from the workspace. It is not trusted to stay in step:
`web/src/lib/capture-policy.test.ts` compares it against the package's constants
and fails the build on any drift.

## Reading a job board

The Job Scout page's scout pipeline can ask this extension to read a board it
watches. That is the one thing here the app starts rather than the user: every
other message drains a queue a toolbar click filled.

It works by opening the board in a **background tab**, waiting for the page's own
JavaScript to render its listings, injecting `harvest.js`, and closing the tab
again. Both halves of that are forced:

- The worker's own `fetch` is `credentials: 'omit'`, so a board you are signed
  into would answer with its sign-in wall. A tab carries your session.
- An MV3 service worker has no `DOMParser`, and a board that renders client-side
  has no listings in its served HTML to parse anyway.

If the board redirects to another host — which is what a sign-in wall does — the
scan is refused rather than harvested, because the links on a login page are not
jobs.

`harvest.js` returns **every** link it can see and judges none of them.
`isJobPostingUrl` in `service/kg/core/board.ts` decides what a posting is, so
that rule has one owner and is never transcribed. A predicate here would be a
second `policy.js` — and a regex is far worse to keep in step than a word list.

Nothing read this way is written to your records. It becomes a suggestion card
you approve or discard.

## Upgrading

An unpacked extension never updates itself. Chrome loads the folder you pointed
it at and keeps loading that folder, so a build from before board reading landed
goes on capturing pages perfectly and refuses to read a board — it has no `tabs`
permission to do it with, and the app says exactly that rather than reporting a
generic failure.

The fix is to reload it: download the current zip from Settings, unzip over the
old folder, and press reload on `chrome://extensions`. Settings shows the
version the browser is actually running, which is the one to compare against the
number in `manifest.json`.

Versions here restart at 0.1.0 with the app's first tagged release. Earlier
unpacked builds used the same two numbers to mean different things, which is why
this section describes the capability rather than the number: what matters is
whether the build you have can read a board, not what it calls itself.
