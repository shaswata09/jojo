# jojo — keep this posting

A browser extension with three jobs, and they are all the same job wearing
different hats: **it is the part of jojo that is not a page.**

1. It saves a job posting into your jojo vault exactly as it reads today.
2. It is how the Job Scout agent reads a job board.
3. It is how jojo reaches a document reader running on your own machine, and how
   it reaches a model provider that sends no CORS headers.

Nothing else in jojo can open a web page, and nothing else can call a server on
`127.0.0.1` from a page served over https.

It exists because a job posting is the one document in a search that belongs to
somebody else. The listing comes down the week after the interview and takes the
requirements with it — the ones you are about to be asked about.

## Where the bridge runs

`content_scripts.matches` in `manifest.json` decides, on which origins,
`bridge.js` exists at all. It is the whole of the security boundary — a content
script cannot ask a page to prove who it is — and it is also the most common way
for this extension to look broken.

Two rules, both learned the hard way:

- **Every pattern needs a path.** `https://example.com` is invalid;
  `https://example.com/*` is not. Chrome's response to ONE invalid pattern is to
  drop the entire `content_scripts` block, so the extension installs, reports
  itself healthy, and injects nothing anywhere. The only symptom is the app
  saying "the jojo browser extension did not answer".
- **The deployed origin has to be listed.** It is
  `https://shaswata09.github.io/jojo/*`. Without it the hosted app cannot reach
  a reader or a model on your own machine at all — an `https://` page may not
  fetch `http://127.0.0.1`, and relaying that hop is the reason this extension
  exists. A fork served from somewhere else sets `JOJO_APP_ORIGIN` when packing:

  ```
  JOJO_APP_ORIGIN=https://you.github.io/jojo npm -w web run pack-extension
  ```

The dev entries are written out one port at a time rather than as a single
wildcard. A wildcard handed this bridge to every page on every local server —
any second dev server could have taken the capture queue.

`npm -w web run pack-extension` refuses to build if any script in this directory
fails to parse, because that failure is otherwise completely silent.

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

## The same argument, for the document reader

jojo can read what is inside your PDFs and Word files by asking
[MarkItDown](https://github.com/microsoft/markitdown) — `markitdown-mcp`, run by
you, listening on `127.0.0.1:3001`. A page cannot call it, and there are two
independent reasons rather than one:

- **No CORS headers.** Measured against markitdown 1.8.1: the response carries no
  `access-control-allow-origin` at all, and the preflight `OPTIONS` answers
  **405**. So a page on one port cannot POST to it on another, however local both
  are.
- **Local Network Access.** An `https://` page may not reach `127.0.0.1` even
  with the headers, because Chrome made it a user permission rather than a header
  negotiation. `docs/NO-SERVER.md` §1.2 has the measurement, including the
  control that confirms causation.

Running jojo from the dev server hides the first and sidesteps the second: the
server proxies `/reader/mcp`, so the request is same-origin. A **hosted** copy has
no proxy to use — a static host has no process to forward anything with — so
before this the deployed app simply could not use a local reader.

The extension is not a page. It fetches under its own `host_permissions`, so
neither rule applies to it. jojo now hands it the reader request and it makes the
hop.

**Loopback only, and that is the point rather than caution.** This relays a
request the page composed, using the extension's permissions. Without a check on
the address, any script that got onto jojo's origin could ask the worker to fetch
anything on the web and read the answer back — an open proxy wearing jojo's
permissions, which is a much worse bug than the one it fixes. So the worker
parses the address and refuses anything that is not `127.0.0.1`, `localhost` or
`[::1]` over plain http. It is parsed rather than string-matched because
`http://127.0.0.1@evil.example.com/` passes a `startsWith` test and is a request
to evil.example.com; `web/src/lib/reader-relay.test.ts` executes the real
function out of `background.js` and asserts exactly that case.

Board scanning is deliberately different — opening a public page IS its feature,
and it has its own guards. Reading a document has no business leaving this
machine, so it cannot.

## And the same argument again, for model providers

Several of the providers in jojo's list cannot be called from a page either, for
the first of the two reasons above. Measured against `integrate.api.nvidia.com`,
which is the free one and therefore the one most people will meet: the preflight
answers **200** carrying `vary: Origin` and **no `access-control-allow-origin`
at all**, so the browser blocks the real request and the page reports a bare
`Failed to fetch` that names nothing.

`jojo:call-model` relays those, and its allowlist is loopback **plus** the
provider hosts in `policy.js` — transcribed from `service/kg/core/provider.ts`
and checked against it by `web/src/lib/capture-policy.test.ts`, so a host cannot
drift in or out unnoticed. Exact hostname match, not a suffix test, because
`endsWith('openai.com')` also accepts `evil-openai.com`.

A local model server needs none of this and does not use it: it is on this
machine, and the page reaches it directly.

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
favicon and as both app launchers, and the drawing is shared rather than
repeated: `scripts/jojo-mark.mjs` at the root of the repo holds the geometry,
copied out of `web/public/favicon.svg`'s own 512-unit viewBox rather than
redrawn by eye, and `mobile/scripts/make-app-icons.mjs` draws the phone icons
from the same file. Editing the PNGs directly is pointless: the next build
overwrites them.

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
