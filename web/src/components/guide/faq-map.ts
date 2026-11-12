/**
 * The code flow map the FAQ page draws: what each layer is for, how a request
 * travels through them, what keeps the layering honest, and where a change
 * belongs.
 *
 * Data, not prose inside a component, for two reasons. The page renders it in
 * several shapes (a diagram, step lists, tables), and `faq-map.test.ts` checks
 * that every path below still exists — a map whose file names have rotted is
 * worse than no map, because it is read by someone deciding where to put code.
 *
 * Built from the code on 2026-11-11 (imports, entry points and the gate
 * scripts), not from comments. When a module moves, the test fails here first.
 */

export type FaqLayerId =
  | 'web'
  | 'mobile'
  | 'extension'
  | 'bridge'
  | 'react'
  | 'agent'
  | 'tools'
  | 'repo'
  | 'core'
  | 'storage'
  | 'adapters'

export type FaqModule = { readonly path: string; readonly role: string }

export type FaqLayer = {
  readonly id: FaqLayerId
  readonly name: string
  readonly path: string
  readonly does: string
  readonly mayImport: string
  readonly modules: readonly FaqModule[]
}

export type FaqStep = { readonly layer: FaqLayerId; readonly path: string; readonly does: string }
export type FaqFlow = { readonly id: string; readonly name: string; readonly steps: readonly FaqStep[] }
export type FaqRule = { readonly rule: string; readonly enforcedBy: readonly string[] }
export type FaqQuestion = { readonly q: string; readonly a: string }

/** Top of the stack first: the three things a person touches, then the shared service downward. */
export const FAQ_LAYERS: readonly FaqLayer[] = [
  {
    id: 'web',
    name: 'Web app',
    path: 'web/src',
    does: 'The browser UI: routes, components and dialogs. Its lib/ wires the platform in — boot, the model transport, the extension bridge, backup, the MCP link.',
    mayImport: 'Any service layer, through the package’s exports map; web-only packages.',
    modules: [
      { path: 'web/src/main.tsx', role: 'Entry and provider stack; DialogHost and ApprovalHost sit beside the router' },
      { path: 'web/src/App.tsx', role: 'Router, AppShell and every route' },
      { path: 'web/src/lib/store.tsx', role: 'Boots the store on IndexedDB and mounts KgProvider' },
      { path: 'web/src/lib/llm.ts', role: 'Sends model requests, directly or through the extension' },
      { path: 'web/src/lib/capture-bridge.ts', role: 'postMessage client for the extension: capture, board scan, relays' },
      { path: 'web/src/lib/pipelines.tsx', role: 'Wires the model and board scan into the Job Scout engine' },
      { path: 'web/src/lib/host.ts', role: 'The web implementation of the Host port' },
    ],
  },
  {
    id: 'mobile',
    name: 'Mobile app',
    path: 'mobile/src',
    does: 'The phone UI (React Native): screens, sheets and navigation. Its lib/ wires the device in — boot, model calls, WebView capture, documents on disk, the transfer receiver.',
    mayImport: 'Any service layer, through the package’s exports map; React Native packages.',
    modules: [
      { path: 'mobile/App.tsx', role: 'Entry and provider stack' },
      { path: 'mobile/src/lib/store.tsx', role: 'Boots the store on AsyncStorage and mounts KgProvider' },
      { path: 'mobile/src/navigation/index.tsx', role: 'Tabs and the screen stack' },
      { path: 'mobile/src/sheets/ApplicationSheet.tsx', role: 'Create/edit application form' },
      { path: 'mobile/src/lib/capture-script.ts', role: 'Script injected into the WebView to keep a posting page' },
      { path: 'mobile/src/lib/handoff-receive.ts', role: 'Receives a transfer from the web app over the LAN' },
      { path: 'mobile/src/lib/host.ts', role: 'The phone implementation of the Host port' },
    ],
  },
  {
    id: 'extension',
    name: 'Browser extension',
    path: 'web/extension',
    does: 'Does what a web page cannot: opens postings and job boards in a tab with the person’s own sign-in, keeps pages, relays model calls past CORS. Plain JavaScript; it cannot import the service.',
    mayImport: 'Nothing. policy.js is a hand copy of core/capture.ts, checked by a test.',
    modules: [
      { path: 'web/extension/manifest.json', role: 'Permissions and where the bridge is injected' },
      { path: 'web/extension/bridge.js', role: 'Content script on jojo’s page: relays postMessage to the worker' },
      { path: 'web/extension/background.js', role: 'Service worker: opens tabs, injects scripts, inlines assets, relays HTTP' },
      { path: 'web/extension/serialise.js', role: 'Turns a posting tab into one self-contained HTML file' },
      { path: 'web/extension/harvest.js', role: 'Returns every link on a board page, without judging them' },
      { path: 'web/extension/policy.js', role: 'Copy of the capture rules in core/capture.ts' },
    ],
  },
  {
    id: 'bridge',
    name: 'jojo-bridge',
    path: 'jojo-bridge.mjs',
    does: 'A small Node process on 127.0.0.1 that lets an MCP client such as Claude Code reach the open jojo tab. It owns only the hop; the tab owns MCP.',
    mayImport: 'Node built-ins only.',
    modules: [{ path: 'jojo-bridge.mjs', role: 'POST /mcp from the client; the tab long-polls /tab/next and replies' }],
  },
  {
    id: 'react',
    name: 'L4 react',
    path: 'service/kg/react',
    does: 'The React binding both apps share: the store provider, graph subscription, one hook per domain that turns tool calls into functions a screen can call, and long-running work (agent runs, pipelines, jobs) that outlives a screen.',
    mayImport: 'Every service layer below it, and React.',
    modules: [
      { path: 'service/kg/react/kg.tsx', role: 'KgProvider: repository, tool runtime, projections, today' },
      { path: 'service/kg/react/kg-context.ts', role: 'useGraph and useKg' },
      { path: 'service/kg/react/use-tool.ts', role: 'useRun (raw) and useTool (with undo and a toast)' },
      { path: 'service/kg/react/use-applications.ts', role: 'Applications: add, update, remove, stage' },
      { path: 'service/kg/react/agent-runs.ts', role: 'Assistant runs that keep going when you leave the screen' },
      { path: 'service/kg/react/use-pipelines.ts', role: 'The Job Scout scheduler and its approval queue' },
      { path: 'service/kg/react/host.ts', role: 'The Host port each app implements' },
    ],
  },
  {
    id: 'agent',
    name: 'L3.5 agent',
    path: 'service/kg/agent',
    does: 'Everything model-driven: the turn loop, the tool catalog the model sees, tool narrowing, the context budget and compaction, reads, scout pipeline prompts and the MCP server. The model call and the tool host are injected — no network or clock here.',
    mayImport: 'core and tools.',
    modules: [
      { path: 'service/kg/agent/loop.ts', role: 'runAgent: the turn loop, approval gate, stuck detection' },
      { path: 'service/kg/agent/execute.ts', role: 'callTool: the one executor the loop and MCP share' },
      { path: 'service/kg/agent/catalog.ts', role: 'The tools the model is offered, as function specs' },
      { path: 'service/kg/agent/queries.ts', role: 'Reads: memory.list/get/search, board.search and more' },
      { path: 'service/kg/agent/compact.ts', role: 'Summarises old turns to fit the context window' },
      { path: 'service/kg/agent/pipelines.ts', role: 'Scout prompts; turns pipeline writes into proposals' },
      { path: 'service/kg/agent/mcp.ts', role: 'MCP JSON-RPC over the same executor' },
    ],
  },
  {
    id: 'tools',
    name: 'L3 tools',
    path: 'service/kg/tools',
    does: 'Every change to the records. Each tool is named, schema-checked, runs in a transaction buffer and commits as one journal entry, so it can be undone. Tools compose through ctx.call; time arrives only as ctx.now.',
    mayImport: 'core, plus named parts of repo.',
    modules: [
      { path: 'service/kg/tools/tool.ts', role: 'defineTool and the context a tool runs with' },
      { path: 'service/kg/tools/runtime.ts', role: 'Checks, runs, commits, undoes' },
      { path: 'service/kg/tools/index.ts', role: 'The TOOLS registry' },
      { path: 'service/kg/tools/application.ts', role: 'application.create / update / delete' },
      { path: 'service/kg/tools/vault.ts', role: 'Files, links, snippets and people' },
      { path: 'service/kg/tools/pipeline.ts', role: 'Scout proposals: raise, approve, discard' },
    ],
  },
  {
    id: 'repo',
    name: 'L2 repo',
    path: 'service/kg/repo',
    does: 'Owns the live graph: commits, the journal and undo ring, the write queue that drains to storage, boot, seeding and whole-store restore.',
    mayImport: 'core and storage; repo/seed.ts alone may read the demo fixtures.',
    modules: [
      { path: 'service/kg/repo/repository.ts', role: 'commit, subscribe, undo/redo, replaceAll' },
      { path: 'service/kg/repo/journal.ts', role: 'Journal entries and their inverses' },
      { path: 'service/kg/repo/queue.ts', role: 'Coalescing write queue with retries' },
      { path: 'service/kg/repo/boot.ts', role: 'Open the driver, migrate, seed, build the session' },
      { path: 'service/kg/repo/restore.ts', role: 'Replace the store from a backup' },
    ],
  },
  {
    id: 'core',
    name: 'L1 core',
    path: 'service/kg/core',
    does: 'The domain itself, as pure functions: record types, schemas, validation, projections, dates, capture and board rules, provider wire formats, backup and transfer formats. No packages, no DOM, no network, no clock — today is always a parameter.',
    mayImport: 'Only core. (service/data holds the vocabulary and demo fixtures on top of it.)',
    modules: [
      { path: 'service/kg/core/model.ts', role: 'Node and edge types — the vocabulary of the graph' },
      { path: 'service/kg/core/snapshot.ts', role: 'The in-memory graph' },
      { path: 'service/kg/core/schema.ts', role: 'The input schema language tools use' },
      { path: 'service/kg/core/validate.ts', role: 'Checks stored rows at the trust boundary' },
      { path: 'service/kg/core/capture.ts', role: 'Page capture rules and posting identity' },
      { path: 'service/kg/core/provider.ts', role: 'The model provider table' },
      { path: 'service/kg/core/backup.ts', role: 'The backup file format' },
    ],
  },
  {
    id: 'storage',
    name: 'L0 storage',
    path: 'service/kg/storage',
    does: 'The ports: a Driver for rows and a FileStore for document bytes, the stored schema and its migrations, an in-memory driver, and the conformance suites every platform adapter must pass.',
    mayImport: 'Only storage.',
    modules: [
      { path: 'service/kg/storage/driver.ts', role: 'The Driver port' },
      { path: 'service/kg/storage/file-store.ts', role: 'The FileStore port' },
      { path: 'service/kg/storage/migrations.ts', role: 'Stored-row upgrades between versions' },
      { path: 'service/kg/storage/memory-driver.ts', role: 'In-memory driver for tests and demo boot' },
      { path: 'service/kg/storage/driver-conformance.ts', role: 'The suite every driver runs' },
    ],
  },
  {
    id: 'adapters',
    name: 'Platform adapters',
    path: 'web/src/kg/storage',
    does: 'Each app’s implementation of the storage ports: IndexedDB on the web, AsyncStorage on the phone. They import only the storage ports and the logger.',
    mayImport: 'Only the service’s storage ports and its logger.',
    modules: [
      { path: 'web/src/kg/storage/idb-driver.ts', role: 'Driver over IndexedDB' },
      { path: 'web/src/kg/storage/idb-file-store.ts', role: 'Document bytes in IndexedDB' },
      { path: 'mobile/src/kg/storage/rn-driver.ts', role: 'Driver over AsyncStorage' },
    ],
  },
]

export const FAQ_FLOWS: readonly FaqFlow[] = [
  {
    id: 'create-web',
    name: 'Creating an application in the web form',
    steps: [
      { layer: 'web', path: 'web/src/components/applications/ApplicationDialog.tsx', does: 'Validates the form and runs the duplicate check before saving.' },
      { layer: 'web', path: 'web/src/components/applications/dialog/use-application-writes.ts', does: 'Saves the record, its keywords, the posting filing and the deadline.' },
      { layer: 'react', path: 'service/kg/react/use-applications.ts', does: 'add() maps the draft and runs application.create.' },
      { layer: 'tools', path: 'service/kg/tools/runtime.ts', does: 'Checks the input against the schema and runs the tool in a buffer.' },
      { layer: 'tools', path: 'service/kg/tools/application.ts', does: 'Mints the id and slug, writes the node, links the employer.' },
      { layer: 'repo', path: 'service/kg/repo/repository.ts', does: 'Commits: updates the graph, journals the undo, queues the write.' },
      { layer: 'adapters', path: 'web/src/kg/storage/idb-driver.ts', does: 'The queue drains to IndexedDB; other tabs are told.' },
      { layer: 'react', path: 'service/kg/react/kg.tsx', does: 'Subscribers re-render; the board and table show the new card.' },
    ],
  },
  {
    id: 'chat-turn',
    name: 'One assistant turn that changes a record',
    steps: [
      { layer: 'web', path: 'web/src/routes/Assistant.tsx', does: 'The composer sends the message to the open conversation.' },
      { layer: 'web', path: 'web/src/lib/use-conversation.ts', does: 'Adds the conversation’s context and supplies the model call.' },
      { layer: 'react', path: 'service/kg/react/agent-runs.ts', does: 'Starts a run with the conversation’s approval mode (manual, semi, auto).' },
      { layer: 'agent', path: 'service/kg/agent/loop.ts', does: 'Narrows the tools, fits the history in the window, asks the model.' },
      { layer: 'web', path: 'web/src/lib/llm.ts', does: 'Sends the request to the model server, directly or via the extension.' },
      { layer: 'agent', path: 'service/kg/agent/execute.ts', does: 'Repairs the arguments, applies the approval gate, runs the tool or read.' },
      { layer: 'tools', path: 'service/kg/tools/runtime.ts', does: 'Runs the tool and commits one undoable journal entry.' },
      { layer: 'web', path: 'web/src/components/assistant/Transcript.tsx', does: 'Shows each step and its result.' },
    ],
  },
  {
    id: 'scout',
    name: 'A Job Scout round, up to an approved posting',
    steps: [
      { layer: 'web', path: 'web/src/lib/pipelines.tsx', does: 'Supplies the model call and the board scan to the engine.' },
      { layer: 'react', path: 'service/kg/react/use-pipelines.ts', does: 'Picks a due pipeline and starts an agent run for it.' },
      { layer: 'agent', path: 'service/kg/agent/pipelines.ts', does: 'Turns every write the model attempts into a proposal card.' },
      { layer: 'agent', path: 'service/kg/agent/queries.ts', does: 'board.search reads only the boards the pipeline lists.' },
      { layer: 'web', path: 'web/src/lib/capture-bridge.ts', does: 'Asks the extension to open the board and collect its links.' },
      { layer: 'core', path: 'service/kg/core/board.ts', does: 'Keeps only links that look like postings, and drops known ones.' },
      { layer: 'web', path: 'web/src/components/scout/ProposalQueue.tsx', does: 'The person approves a card.' },
      { layer: 'tools', path: 'service/kg/tools/pipeline.ts', does: 'pipeline.proposal.approve runs the proposed write in one entry.' },
    ],
  },
  {
    id: 'from-link',
    name: '“From link”: reading a posting through the extension',
    steps: [
      { layer: 'web', path: 'web/src/components/applications/AddFromLinkDialog.tsx', does: 'Takes the posting URL.' },
      { layer: 'web', path: 'web/src/lib/posting-agent.ts', does: 'Opens the page through the extension, or the document reader without one.' },
      { layer: 'web', path: 'web/src/lib/capture-bridge.ts', does: 'Posts a capture request and waits for the page.' },
      { layer: 'extension', path: 'web/extension/bridge.js', does: 'Relays the request to the service worker.' },
      { layer: 'extension', path: 'web/extension/background.js', does: 'Opens the tab, serialises it, inlines assets, returns one HTML file.' },
      { layer: 'agent', path: 'service/kg/agent/read-posting.ts', does: 'The model reads the page into a draft: employer, role, deadline.' },
      { layer: 'web', path: 'web/src/lib/file-capture.ts', does: 'Keeps the page in the Vault under Job postings.' },
      { layer: 'web', path: 'web/src/components/applications/ApplicationDialog.tsx', does: 'Opens prefilled; saving files the page under the new application.' },
    ],
  },
  {
    id: 'transfer',
    name: 'Sending everything to the phone',
    steps: [
      { layer: 'web', path: 'web/src/components/transfer-ui/SendPanel.tsx', does: 'The person starts a transfer (or Settings → Data for a backup file).' },
      { layer: 'core', path: 'service/kg/core/pairing.ts', does: 'The phone scans the QR code; both sides agree session keys.' },
      { layer: 'mobile', path: 'mobile/src/lib/handoff-receive.ts', does: 'Starts the LAN receiver; only private addresses are accepted.' },
      { layer: 'web', path: 'web/src/lib/handoff-send.ts', does: 'Streams the backup, encrypted, in chunks to the phone.' },
      { layer: 'mobile', path: 'mobile/src/lib/receive-decision.ts', does: 'Reassembles it; the person decides whether to replace.' },
      { layer: 'mobile', path: 'mobile/src/lib/restore-received.ts', does: 'Validates the backup and replaces the store; documents are written to disk.' },
      { layer: 'repo', path: 'service/kg/repo/restore.ts', does: 'restoreBackup checks every row, then swaps the whole store.' },
    ],
  },
  {
    id: 'create-mobile',
    name: 'Creating an application on the phone',
    steps: [
      { layer: 'mobile', path: 'mobile/src/lib/create-actions.ts', does: 'The + menu opens the application sheet.' },
      { layer: 'mobile', path: 'mobile/src/sheets/ApplicationSheet.tsx', does: 'Validates, runs the duplicate check, then saves.' },
      { layer: 'mobile', path: 'mobile/src/lib/store-context.ts', does: 'Hands the screen the same service hooks the web uses.' },
      { layer: 'react', path: 'service/kg/react/use-applications.ts', does: 'The same add() as on the web.' },
      { layer: 'tools', path: 'service/kg/tools/application.ts', does: 'The same tool and runtime.' },
      { layer: 'repo', path: 'service/kg/repo/repository.ts', does: 'The same commit, journal and queue.' },
      { layer: 'adapters', path: 'mobile/src/kg/storage/rn-driver.ts', does: 'The queue drains to AsyncStorage instead of IndexedDB.' },
    ],
  },
]

export const FAQ_RULES: readonly FaqRule[] = [
  { rule: 'Service imports only point down the stack, layer by layer; tools may use only named parts of repo.', enforcedBy: ['service/scripts/check-layers.mjs'] },
  { rule: 'Only kg/react may use React or be a .tsx file.', enforcedBy: ['service/scripts/check-layers.mjs'] },
  { rule: 'Demo fixtures in service/data are read only by repo/seed.ts.', enforcedBy: ['service/scripts/check-layers.mjs'] },
  { rule: 'No DOM, Node, network or timer globals in the pure layers; time enters as a parameter, never as a read of the clock.', enforcedBy: ['service/scripts/check-platform.mjs'] },
  { rule: 'No bare console in the service — use the [kg] logger.', enforcedBy: ['service/scripts/check-platform.mjs', 'service/kg/log.ts'] },
  { rule: 'Platform adapters import only the storage ports and the logger.', enforcedBy: ['service/scripts/check-layers.mjs'] },
  { rule: 'Every storage driver passes the same conformance suite.', enforcedBy: ['service/kg/storage/driver-conformance.ts', 'web/src/kg/storage/idb-conformance.test.ts', 'mobile/src/kg/storage/rn-conformance.test.ts'] },
  { rule: 'One copy of the service: apps import it through the exports map, and no file is copied between apps.', enforcedBy: ['service/scripts/check-no-copies.mjs'] },
  { rule: 'Every tool that calls another tool declares it.', enforcedBy: ['service/scripts/check-compositions.mjs'] },
  { rule: 'Every tool round-trips: it runs, changes the graph, and undo restores it exactly.', enforcedBy: ['service/test/coverage.test.ts'] },
  { rule: 'Nothing drawn outside the web router uses router hooks; nothing beside the phone navigator calls useNavigation.', enforcedBy: ['web/scripts/check-outside-router.mjs', 'mobile/scripts/check-overlays.mjs'] },
  { rule: 'The extension’s copy of the capture rules matches core, and its permissions are pinned.', enforcedBy: ['web/src/lib/capture-policy.test.ts', 'web/src/lib/extension-manifest.test.ts'] },
  { rule: 'Model API keys never enter the graph, a backup or a transfer.', enforcedBy: ['service/test/keys-stay-local.test.ts', 'web/src/lib/keys-stay-local.test.ts'] },
  { rule: 'All of it runs as typecheck, lint and tests for every workspace, locally and in CI.', enforcedBy: ['gate.sh', '.github/workflows/ci.yml'] },
]

export const FAQ_PLACEMENT: readonly FaqQuestion[] = [
  {
    q: 'Where does a new domain rule go — say, how urgent a deadline is?',
    a: 'A pure function in service/kg/core/<topic>.ts, with a test beside it. Take today as a parameter. Both apps and the tools then import the same function.',
  },
  {
    q: 'Where does a new kind of change to the records go?',
    a: 'A tool in service/kg/tools/<area>.ts, registered in tools/index.ts. Expose it through a hook in service/kg/react. A screen never calls the repository directly.',
  },
  {
    q: 'A form saves several things at once — the record, its keywords, a deadline. Where does that live?',
    a: 'In one tool, so it is one journal entry, one Undo, and the assistant gets the same behaviour. application.create and update already take a deadline and keywords. Extend the tool rather than chaining calls in a dialog or sheet.',
  },
  {
    q: 'Where does a new read or derived view go?',
    a: 'A projection in service/kg/core/project.ts and a hook in service/kg/react. If the assistant should be able to ask for it, add a read in service/kg/agent/queries.ts.',
  },
  {
    q: 'I am adding a screen to both apps. What goes where?',
    a: 'Web: a route in web/src/routes, components in web/src/components/<area>, and the path in App.tsx and lib/links.ts. Phone: mobile/src/screens plus navigation/index.tsx. Both read the same service hooks. Anything beyond layout and platform wiring belongs in the service, never written twice.',
  },
  {
    q: 'Where do I add a model provider?',
    a: 'An entry in PROVIDERS in service/kg/core/provider.ts; request and response shaping beside it (core/model-server.ts or core/anthropic.ts). The apps’ llm.ts only send. A cloud host also needs the extension’s relay allowlist.',
  },
  {
    q: 'Where does a page-capture rule go?',
    a: 'The constant in service/kg/core/capture.ts, then the hand copy in web/extension/policy.js (a test fails until they match). The phone picks it up through mobile/src/lib/capture-script.ts.',
  },
  {
    q: 'Where does a job-board rule go?',
    a: 'service/kg/core/board.ts. web/extension/harvest.js stays simple and returns every link.',
  },
  {
    q: 'The service needs something only a platform can do — clipboard, haptics, flushing on suspend.',
    a: 'Add it to the Host port in service/kg/react/host.ts and implement it in web/src/lib/host.ts and mobile/src/lib/host.ts. Reaching for window or document in the service fails the gate.',
  },
  {
    q: 'Where does a storage change go?',
    a: 'A new backend implements the ports in <app>/src/kg/storage and runs the conformance suite. A change to stored rows goes in storage/migrations.ts, with core/model.ts and core/validate.ts.',
  },
  {
    q: 'Where do demo data and fixtures go?',
    a: 'service/data. Only service/kg/repo/seed.ts may import them.',
  },
  {
    q: 'Where does a new Job Scout pipeline kind go?',
    a: 'Its allowed tools in service/kg/core/proposal.ts and its prompt in service/kg/agent/pipelines.ts.',
  },
]

/** Every repo path this page names — what `faq-map.test.ts` checks still exists. */
export function faqPaths(): string[] {
  const paths = new Set<string>()
  for (const layer of FAQ_LAYERS) {
    paths.add(layer.path)
    for (const m of layer.modules) paths.add(m.path)
  }
  for (const flow of FAQ_FLOWS) for (const step of flow.steps) paths.add(step.path)
  for (const rule of FAQ_RULES) for (const p of rule.enforcedBy) paths.add(p)
  return [...paths].sort()
}
