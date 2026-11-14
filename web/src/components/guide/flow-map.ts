/**
 * The hand-written half of the Control flow graph page: what each layer is for,
 * the control flow of six journeys, what keeps the layering honest, and where
 * a change belongs. The other half — the code flow graph of every file and
 * import — is computed from the source at build time (`scripts/code-graph.mjs`).
 *
 * Data, not prose inside a component, for two reasons. The page renders it in
 * several shapes (flowcharts, lists, tables), and `flow-map.test.ts` checks
 * that every path below still exists — a map whose file names have rotted is
 * worse than no map, because it is read by someone deciding where to put code.
 *
 * Built from the code on 2026-11-11 (imports, entry points and the gate
 * scripts), not from comments. When a module moves, the test fails here first.
 */

export type FlowLayerId =
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

export type FlowModule = { readonly path: string; readonly role: string }

export type FlowLayer = {
  readonly id: FlowLayerId
  readonly name: string
  readonly path: string
  readonly does: string
  readonly mayImport: string
  readonly modules: readonly FlowModule[]
}

export type FlowNodeKind = 'start' | 'step' | 'decision' | 'stop' | 'end'

export type FlowNode = {
  readonly id: string
  readonly kind: FlowNodeKind
  readonly label: string
  readonly layer: FlowLayerId
  /** The file that makes this step or decision. */
  readonly path: string
}

export type FlowEdge = {
  readonly from: string
  readonly to: string
  /** The branch taken — every edge out of a decision carries one. */
  readonly label?: string
  /** Loops back to an earlier node; ignored when ranking nodes for layout. */
  readonly back?: boolean
}

export type ControlFlow = {
  readonly id: string
  readonly name: string
  readonly summary: string
  readonly nodes: readonly FlowNode[]
  readonly edges: readonly FlowEdge[]
}

/** A connection that is not an import. Group ids as `code-graph.mjs` names them. */
export type Channel = { readonly from: string; readonly to: string; readonly label: string; readonly path: string }
export type FlowRule = { readonly rule: string; readonly enforcedBy: readonly string[] }
export type FlowQuestion = { readonly q: string; readonly a: string }

/** Top of the stack first: the three things a person touches, then the shared service downward. */
export const FLOW_LAYERS: readonly FlowLayer[] = [
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
      { path: 'web/src/lib/scout-reading-queue.ts', role: 'Which scout cards are read in the background, the one-at-a-time lock, readings kept for Approve' },
      { path: 'web/src/lib/posting-target.ts', role: 'Refuses local and private addresses before a posting is opened' },
      { path: 'web/scripts/csp.mjs', role: 'The production Content-Security-Policy, hashed from the built page' },
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
      { path: 'web/extension/background.js', role: 'Service worker entry: registers the listeners; the work is in worker/' },
      { path: 'web/extension/worker/capture.js', role: 'Capture a page by address: open the tab, check for sign-in, serialise' },
      { path: 'web/extension/worker/inline.js', role: 'Inline a capture’s assets by a deadline, refusing local addresses' },
      { path: 'web/extension/worker/scan-board.js', role: 'Read a job board: open it, press Load more, collect its links' },
      { path: 'web/extension/worker/routing.js', role: 'Which model hosts and local ports the relay may reach' },
      { path: 'web/extension/worker/messages.js', role: 'Message dispatch: which verbs a page may send, which only the popup' },
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
      { path: 'service/kg/agent/loop.ts', role: 'runAgent: one turn, composed from the phase modules beside it' },
      { path: 'service/kg/agent/round.ts', role: 'One model round: retries an empty turn, continues a cut-off one' },
      { path: 'service/kg/agent/perform-call.ts', role: 'One tool call: offered check, repair, approval gate, run' },
      { path: 'service/kg/agent/execute.ts', role: 'callTool: the one executor the loop and MCP share' },
      { path: 'service/kg/agent/catalog.ts', role: 'The tools the model is offered, as function specs' },
      { path: 'service/kg/agent/queries.ts', role: 'The READS registry, in the order the model sees them' },
      { path: 'service/kg/agent/reads', role: 'One module per read: memory, graph, vault file, board, calc, stats' },
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
      { path: 'service/kg/tools/vault-files.ts', role: 'Vault files: add, update, move, notes, delete' },
      { path: 'service/kg/tools/vault-people.ts', role: 'People and referees, with their roles per application' },
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
      { path: 'service/kg/core/sent-on.ts', role: 'The one rule for the date an application was sent' },
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

/*
 * The control flow graphs: six journeys as flowcharts, with the branches the
 * code actually takes. Every node names the file that makes that decision, and
 * `flow-map.test.ts` checks the graphs are well formed (one start, every node
 * reachable, every decision with labelled ways out) and that every file exists.
 *
 * `back` marks an edge that loops to an earlier node — the agent asking the
 * model again, a send retrying with a fresh code. Layout ignores those when it
 * ranks nodes, so a loop never pushes the start of the chart to the bottom.
 */
export const CONTROL_FLOWS: readonly ControlFlow[] = [
  {
    id: 'create-web',
    name: 'Creating an application',
    summary: 'The web form, from Save to the card on the board, including every way it can stop.',
    nodes: [
      { id: 'save', kind: 'start', label: 'Save pressed in the application form', layer: 'web', path: 'web/src/components/applications/ApplicationDialog.tsx' },
      { id: 'valid', kind: 'decision', label: 'Form valid?', layer: 'web', path: 'web/src/components/applications/dialog/form-state.ts' },
      { id: 'invalid', kind: 'stop', label: 'Field errors shown; nothing saved', layer: 'web', path: 'web/src/components/applications/dialog/form-state.ts' },
      { id: 'dup', kind: 'decision', label: 'Looks like one you already have? (posting ID → URL → name → model judge)', layer: 'web', path: 'web/src/lib/duplicate-agent.ts' },
      { id: 'confirm', kind: 'decision', label: 'Person: open the existing one, or save anyway?', layer: 'web', path: 'web/src/components/applications/ApplicationDialog.tsx' },
      { id: 'opened', kind: 'end', label: 'Existing record opened; nothing saved', layer: 'web', path: 'web/src/components/applications/ApplicationDialog.tsx' },
      { id: 'write', kind: 'step', label: 'One application.create, with deadline and keywords', layer: 'web', path: 'web/src/components/applications/dialog/use-application-writes.ts' },
      { id: 'hook', kind: 'step', label: 'add() runs the tool through the runtime', layer: 'react', path: 'service/kg/react/use-applications.ts' },
      { id: 'check', kind: 'decision', label: 'Input matches the schema and the tool is available?', layer: 'tools', path: 'service/kg/tools/runtime.ts' },
      { id: 'refused', kind: 'stop', label: 'Refusal shown on its field; form stays open', layer: 'web', path: 'web/src/components/applications/dialog/form-state.ts' },
      { id: 'run', kind: 'step', label: 'Mint id and slug, org.ensure, sync deadline and keywords', layer: 'tools', path: 'service/kg/tools/application.ts' },
      { id: 'commit', kind: 'step', label: 'Commit: graph, journal, undo ring, write queue', layer: 'repo', path: 'service/kg/repo/repository.ts' },
      { id: 'disk', kind: 'decision', label: 'IndexedDB write succeeded?', layer: 'adapters', path: 'web/src/kg/storage/idb-driver.ts' },
      { id: 'banner', kind: 'stop', label: 'Storage banner: changes are only in this tab', layer: 'web', path: 'web/src/components/layout/StorageBanner.tsx' },
      { id: 'shown', kind: 'end', label: 'Subscribers re-render; toast offers Undo', layer: 'react', path: 'service/kg/react/kg.tsx' },
    ],
    edges: [
      { from: 'save', to: 'valid' },
      { from: 'valid', to: 'invalid', label: 'no' },
      { from: 'valid', to: 'dup', label: 'yes' },
      { from: 'dup', to: 'confirm', label: 'maybe' },
      { from: 'dup', to: 'write', label: 'no' },
      { from: 'confirm', to: 'opened', label: 'open it' },
      { from: 'confirm', to: 'write', label: 'save anyway' },
      { from: 'write', to: 'hook' },
      { from: 'hook', to: 'check' },
      { from: 'check', to: 'refused', label: 'no' },
      { from: 'check', to: 'run', label: 'yes' },
      { from: 'run', to: 'commit' },
      { from: 'commit', to: 'disk' },
      { from: 'disk', to: 'shown', label: 'yes' },
      { from: 'disk', to: 'banner', label: 'no' },
    ],
  },
  {
    id: 'chat-turn',
    name: 'One assistant turn',
    summary: 'From a message to an answer: tool narrowing, the context budget, the approval gate and every refusal the model can meet.',
    nodes: [
      { id: 'send', kind: 'start', label: 'Message sent', layer: 'web', path: 'web/src/components/assistant/use-conversation-panel.ts' },
      { id: 'wire', kind: 'step', label: 'Conversation context and the model call wired in', layer: 'web', path: 'web/src/lib/use-conversation.ts' },
      { id: 'start', kind: 'step', label: 'Run starts with the conversation’s approval mode', layer: 'react', path: 'service/kg/react/agent-runs.ts' },
      { id: 'clear', kind: 'decision', label: 'Can the words alone pick the tools?', layer: 'agent', path: 'service/kg/agent/retrieve.ts' },
      { id: 'chooser', kind: 'step', label: 'A short model call picks the tools', layer: 'agent', path: 'service/kg/agent/retrieve-llm.ts' },
      { id: 'fits', kind: 'decision', label: 'History fits the context window?', layer: 'agent', path: 'service/kg/agent/budget.ts' },
      { id: 'compact', kind: 'step', label: 'Summarise older turns; keep an id ledger', layer: 'agent', path: 'service/kg/agent/compact.ts' },
      { id: 'ask', kind: 'step', label: 'Ask the model', layer: 'web', path: 'web/src/lib/llm.ts' },
      { id: 'stop', kind: 'decision', label: 'Stop pressed?', layer: 'agent', path: 'service/kg/agent/round.ts' },
      { id: 'stopped', kind: 'end', label: 'Stopped; nothing more runs', layer: 'react', path: 'service/kg/react/agent-runs.ts' },
      { id: 'calls', kind: 'decision', label: 'Did it call a tool?', layer: 'agent', path: 'service/kg/agent/calls.ts' },
      { id: 'verify', kind: 'decision', label: 'Claims a change that never happened?', layer: 'agent', path: 'service/kg/agent/verify-gate.ts' },
      { id: 'answer', kind: 'end', label: 'Answer and steps saved to the conversation', layer: 'react', path: 'service/kg/react/agent-runs.ts' },
      { id: 'offered', kind: 'decision', label: 'Was that tool offered?', layer: 'agent', path: 'service/kg/agent/perform-call.ts' },
      { id: 'repair', kind: 'step', label: 'Repair the arguments against the schema', layer: 'agent', path: 'service/kg/agent/repair.ts' },
      { id: 'partial', kind: 'decision', label: 'Would one item replace a whole list?', layer: 'agent', path: 'service/kg/agent/repair.ts' },
      { id: 'gate', kind: 'decision', label: 'Needs the person’s approval? (mode, destructive, confirms)', layer: 'agent', path: 'service/kg/agent/catalog.ts' },
      { id: 'approve', kind: 'decision', label: 'Person approves?', layer: 'web', path: 'web/src/components/assistant/ApprovalHost.tsx' },
      { id: 'exec', kind: 'decision', label: 'Only declared fields, and the tool accepts them?', layer: 'agent', path: 'service/kg/agent/execute.ts' },
      { id: 'tool', kind: 'step', label: 'Read, or write committed as one undoable entry', layer: 'tools', path: 'service/kg/tools/runtime.ts' },
      { id: 'told', kind: 'step', label: 'Result or refusal written back for the model', layer: 'agent', path: 'service/kg/agent/calls.ts' },
      { id: 'cap', kind: 'decision', label: 'Round cap reached, or going in circles?', layer: 'agent', path: 'service/kg/agent/stuck.ts' },
      { id: 'capped', kind: 'end', label: 'Stopped with what was done so far', layer: 'react', path: 'service/kg/react/agent-runs.ts' },
    ],
    edges: [
      { from: 'send', to: 'wire' },
      { from: 'wire', to: 'start' },
      { from: 'start', to: 'clear' },
      { from: 'clear', to: 'fits', label: 'yes' },
      { from: 'clear', to: 'chooser', label: 'no' },
      { from: 'chooser', to: 'fits' },
      { from: 'fits', to: 'ask', label: 'yes' },
      { from: 'fits', to: 'compact', label: 'no' },
      { from: 'compact', to: 'ask' },
      { from: 'ask', to: 'stop' },
      { from: 'stop', to: 'stopped', label: 'yes' },
      { from: 'stop', to: 'calls', label: 'no' },
      { from: 'calls', to: 'verify', label: 'no' },
      { from: 'verify', to: 'answer', label: 'no' },
      { from: 'verify', to: 'ask', label: 'yes — check first', back: true },
      { from: 'calls', to: 'offered', label: 'yes' },
      { from: 'offered', to: 'told', label: 'no — refused' },
      { from: 'offered', to: 'repair', label: 'yes' },
      { from: 'repair', to: 'partial' },
      { from: 'partial', to: 'told', label: 'yes — refused' },
      { from: 'partial', to: 'gate', label: 'no' },
      { from: 'gate', to: 'approve', label: 'yes' },
      { from: 'gate', to: 'exec', label: 'no' },
      { from: 'approve', to: 'exec', label: 'yes' },
      { from: 'approve', to: 'told', label: 'no — declined' },
      { from: 'exec', to: 'tool', label: 'yes' },
      { from: 'exec', to: 'told', label: 'no — refused' },
      { from: 'tool', to: 'told' },
      { from: 'told', to: 'cap' },
      { from: 'cap', to: 'capped', label: 'yes' },
      { from: 'cap', to: 'ask', label: 'no — next round', back: true },
    ],
  },
  {
    id: 'scout',
    name: 'A Job Scout round',
    summary: 'A due pipeline reads its boards, raises suggestions, reads them in the background, and waits for the person.',
    nodes: [
      { id: 'tick', kind: 'start', label: 'Tick: a pipeline is due', layer: 'react', path: 'service/kg/react/use-pipelines.ts' },
      { id: 'twin', kind: 'decision', label: 'Profile pipeline, and documents not loaded yet?', layer: 'react', path: 'service/kg/react/use-pipelines.ts' },
      { id: 'skip', kind: 'end', label: 'Skipped until the next tick', layer: 'react', path: 'service/kg/react/use-pipelines.ts' },
      { id: 'run', kind: 'step', label: 'Agent run with only this pipeline’s tools; writes become cards', layer: 'agent', path: 'service/kg/agent/pipelines.ts' },
      { id: 'board', kind: 'decision', label: 'board.search: address on this pipeline’s boards?', layer: 'agent', path: 'service/kg/agent/reads/board.ts' },
      { id: 'scan', kind: 'step', label: 'Extension opens the board and collects its links', layer: 'web', path: 'web/src/lib/capture-bridge.ts' },
      { id: 'keep', kind: 'step', label: 'Keep posting links; drop the ones already held', layer: 'core', path: 'service/kg/core/board.ts' },
      { id: 'raise', kind: 'decision', label: 'Allowed for this kind, and not a duplicate?', layer: 'agent', path: 'service/kg/agent/pipelines.ts' },
      { id: 'dropped', kind: 'stop', label: 'Not raised', layer: 'agent', path: 'service/kg/agent/pipelines.ts' },
      { id: 'card', kind: 'step', label: 'Suggestion card raised', layer: 'tools', path: 'service/kg/tools/pipeline.ts' },
      { id: 'auto', kind: 'decision', label: 'Listed on this round’s boards, and not a local address?', layer: 'web', path: 'web/src/lib/scout-reading-queue.ts' },
      { id: 'read', kind: 'step', label: 'Background read: page kept, posting read into a reading', layer: 'web', path: 'web/src/lib/scout-reading.tsx' },
      { id: 'decide', kind: 'decision', label: 'Person: approve or discard?', layer: 'web', path: 'web/src/components/scout/ProposalQueue.tsx' },
      { id: 'approve', kind: 'step', label: 'pipeline.proposal.approve runs the saved write', layer: 'tools', path: 'service/kg/tools/pipeline.ts' },
      { id: 'fill', kind: 'end', label: 'Saved and filled from the reading; Add to applications offered', layer: 'web', path: 'web/src/lib/fill-from-posting.ts' },
      { id: 'discard', kind: 'end', label: 'Discarded; the page is dropped only if the read created it', layer: 'web', path: 'web/src/lib/scout-reading.tsx' },
    ],
    edges: [
      { from: 'tick', to: 'twin' },
      { from: 'twin', to: 'skip', label: 'yes' },
      { from: 'twin', to: 'run', label: 'no' },
      { from: 'run', to: 'board' },
      { from: 'board', to: 'scan', label: 'yes' },
      { from: 'board', to: 'run', label: 'no — refused', back: true },
      { from: 'scan', to: 'keep' },
      { from: 'keep', to: 'raise' },
      { from: 'raise', to: 'dropped', label: 'no' },
      { from: 'raise', to: 'card', label: 'yes' },
      { from: 'card', to: 'auto' },
      { from: 'auto', to: 'read', label: 'yes' },
      { from: 'auto', to: 'decide', label: 'no — waits' },
      { from: 'read', to: 'decide' },
      { from: 'decide', to: 'approve', label: 'approve' },
      { from: 'decide', to: 'discard', label: 'discard' },
      { from: 'approve', to: 'fill' },
    ],
  },
  {
    id: 'from-link',
    name: '“From link”: reading a posting',
    summary: 'A pasted URL becomes a kept page and a prefilled form — through the extension when there is one, the document reader when not.',
    nodes: [
      { id: 'paste', kind: 'start', label: 'Posting URL pasted', layer: 'web', path: 'web/src/components/applications/AddFromLinkDialog.tsx' },
      { id: 'local', kind: 'decision', label: 'Local or private address?', layer: 'web', path: 'web/src/lib/posting-target.ts' },
      { id: 'refuse', kind: 'stop', label: 'Refused', layer: 'web', path: 'web/src/lib/posting-target.ts' },
      { id: 'ext', kind: 'decision', label: 'Extension answering?', layer: 'web', path: 'web/src/lib/capture-bridge.ts' },
      { id: 'capture', kind: 'step', label: 'Worker: open the tab, check for sign-in, copy it inertly, inline assets by a deadline', layer: 'extension', path: 'web/extension/worker/capture.js' },
      { id: 'gate', kind: 'step', label: 'Leak check on the returned page', layer: 'core', path: 'service/kg/core/capture.ts' },
      { id: 'reader', kind: 'decision', label: 'Document reader set up?', layer: 'web', path: 'web/src/lib/markitdown.ts' },
      { id: 'none', kind: 'stop', label: 'Nothing here can open pages: Settings has both', layer: 'web', path: 'web/src/lib/posting-agent.ts' },
      { id: 'fetch', kind: 'step', label: 'Reader fetches the page', layer: 'web', path: 'web/src/lib/markitdown.ts' },
      { id: 'empty', kind: 'decision', label: 'Came back nearly empty?', layer: 'web', path: 'web/src/lib/posting-agent.ts' },
      { id: 'blank', kind: 'stop', label: 'Told to sign in, or use the extension', layer: 'web', path: 'web/src/lib/posting-agent.ts' },
      { id: 'keep', kind: 'decision', label: 'Page kept, and its bytes stored on this device?', layer: 'web', path: 'web/src/lib/vault-blobs.ts' },
      { id: 'unsaved', kind: 'stop', label: 'Record removed again; nothing kept', layer: 'web', path: 'web/src/lib/posting-agent.ts' },
      { id: 'model', kind: 'decision', label: 'Model reads it into a draft? (asked twice at most)', layer: 'agent', path: 'service/kg/agent/read-posting.ts' },
      { id: 'kept', kind: 'end', label: 'Error shown; the page is still in the Vault', layer: 'web', path: 'web/src/components/applications/AddFromLinkDialog.tsx' },
      { id: 'form', kind: 'end', label: 'Form opens prefilled; Save continues as “Creating an application”', layer: 'web', path: 'web/src/components/applications/ApplicationDialog.tsx' },
    ],
    edges: [
      { from: 'paste', to: 'local' },
      { from: 'local', to: 'refuse', label: 'yes' },
      { from: 'local', to: 'ext', label: 'no' },
      { from: 'ext', to: 'capture', label: 'yes' },
      { from: 'ext', to: 'reader', label: 'no' },
      { from: 'capture', to: 'gate' },
      { from: 'gate', to: 'empty' },
      { from: 'reader', to: 'none', label: 'no' },
      { from: 'reader', to: 'fetch', label: 'yes' },
      { from: 'fetch', to: 'empty' },
      { from: 'empty', to: 'blank', label: 'yes' },
      { from: 'empty', to: 'keep', label: 'no' },
      { from: 'keep', to: 'unsaved', label: 'no' },
      { from: 'keep', to: 'model', label: 'yes' },
      { from: 'model', to: 'kept', label: 'no' },
      { from: 'model', to: 'form', label: 'yes' },
    ],
  },
  {
    id: 'transfer',
    name: 'Sending everything to the phone',
    summary: 'Pairing by camera, an encrypted send over the local network, and the phone’s decision to replace.',
    nodes: [
      { id: 'send', kind: 'start', label: 'Send to phone', layer: 'web', path: 'web/src/components/transfer-ui/SendPanel.tsx' },
      { id: 'offer', kind: 'step', label: 'Mint an offer and show its code; refresh before it expires', layer: 'web', path: 'web/src/lib/pairing-session.ts' },
      { id: 'pair', kind: 'decision', label: 'Phone scanned a live code and the handshake held?', layer: 'core', path: 'service/kg/core/pairing.ts' },
      { id: 'listen', kind: 'step', label: 'Phone starts its receiver on the local network', layer: 'mobile', path: 'mobile/src/lib/handoff-receive.ts' },
      { id: 'dial', kind: 'decision', label: 'Address private to this network?', layer: 'core', path: 'service/kg/core/dial.ts' },
      { id: 'nodial', kind: 'stop', label: 'Refused', layer: 'core', path: 'service/kg/core/dial.ts' },
      { id: 'stream', kind: 'step', label: 'Backup streamed, encrypted, in chunks', layer: 'web', path: 'web/src/lib/handoff-send.ts' },
      { id: 'dropped', kind: 'decision', label: 'Connection dropped?', layer: 'core', path: 'service/kg/core/convoy.ts' },
      { id: 'choose', kind: 'decision', label: 'Person on the phone: replace what is there?', layer: 'mobile', path: 'mobile/src/lib/receive-decision.ts' },
      { id: 'kept', kind: 'end', label: 'Nothing changed', layer: 'mobile', path: 'mobile/src/lib/receive-decision.ts' },
      { id: 'check', kind: 'step', label: 'Backup validated; anything unreadable is counted first', layer: 'core', path: 'service/kg/core/backup.ts' },
      { id: 'restore', kind: 'end', label: 'Store replaced; documents written to the phone', layer: 'mobile', path: 'mobile/src/lib/restore-received.ts' },
    ],
    edges: [
      { from: 'send', to: 'offer' },
      { from: 'offer', to: 'pair' },
      { from: 'pair', to: 'offer', label: 'no — new code', back: true },
      { from: 'pair', to: 'listen', label: 'yes' },
      { from: 'listen', to: 'dial' },
      { from: 'dial', to: 'nodial', label: 'no' },
      { from: 'dial', to: 'stream', label: 'yes' },
      { from: 'stream', to: 'dropped' },
      { from: 'dropped', to: 'offer', label: 'yes — new code', back: true },
      { from: 'dropped', to: 'choose', label: 'no' },
      { from: 'choose', to: 'kept', label: 'no' },
      { from: 'choose', to: 'check', label: 'yes' },
      { from: 'check', to: 'restore' },
    ],
  },
  {
    id: 'undo',
    name: 'Undo (⌘Z)',
    summary: 'How a change is taken back field by field, keeping whatever has been written since.',
    nodes: [
      { id: 'key', kind: 'start', label: '⌘Z, or Undo on a toast or a step', layer: 'web', path: 'web/src/lib/host.ts' },
      { id: 'ring', kind: 'decision', label: 'Anything on the undo ring?', layer: 'tools', path: 'service/kg/tools/runtime.ts' },
      { id: 'empty', kind: 'end', label: 'Nothing to undo', layer: 'tools', path: 'service/kg/tools/runtime.ts' },
      { id: 'rebase', kind: 'step', label: 'Rebase the entry against the records as they are now', layer: 'repo', path: 'service/kg/repo/journal.ts' },
      { id: 'group', kind: 'decision', label: 'A field in a group (stage and its dates, text and its formatting) changed since?', layer: 'repo', path: 'service/kg/repo/journal.ts' },
      { id: 'hold', kind: 'step', label: 'Leave that whole group as it is', layer: 'repo', path: 'service/kg/repo/journal.ts' },
      { id: 'used', kind: 'decision', label: 'A record it created is still used by a later one?', layer: 'repo', path: 'service/kg/repo/journal.ts' },
      { id: 'keepit', kind: 'step', label: 'Keep that record', layer: 'repo', path: 'service/kg/repo/journal.ts' },
      { id: 'edges', kind: 'step', label: 'Drop links, and claims, whose other end is gone', layer: 'repo', path: 'service/kg/repo/repository.ts' },
      { id: 'left', kind: 'decision', label: 'Anything left to change?', layer: 'repo', path: 'service/kg/repo/repository.ts' },
      { id: 'nothing', kind: 'end', label: '“Nothing to undo — it has changed since”', layer: 'repo', path: 'service/kg/repo/repository.ts' },
      { id: 'land', kind: 'end', label: 'Landed as a new entry, offered for redo', layer: 'repo', path: 'service/kg/repo/repository.ts' },
    ],
    edges: [
      { from: 'key', to: 'ring' },
      { from: 'ring', to: 'empty', label: 'no' },
      { from: 'ring', to: 'rebase', label: 'yes' },
      { from: 'rebase', to: 'group' },
      { from: 'group', to: 'hold', label: 'yes' },
      { from: 'group', to: 'used', label: 'no' },
      { from: 'hold', to: 'used' },
      { from: 'used', to: 'keepit', label: 'yes' },
      { from: 'used', to: 'edges', label: 'no' },
      { from: 'keepit', to: 'edges' },
      { from: 'edges', to: 'left' },
      { from: 'left', to: 'nothing', label: 'no' },
      { from: 'left', to: 'land', label: 'yes' },
    ],
  },
]

/**
 * Connections between parts that are not imports, drawn dashed on the code
 * flow graph: the extension relay, the bridge to Claude Code, and the
 * local-network hand-off to the phone. `from` and `to` are code-graph group ids.
 */
export const CHANNELS: readonly Channel[] = [
  { from: 'web/lib', to: 'web/extension', label: 'postMessage relay', path: 'web/src/lib/capture-bridge.ts' },
  { from: 'web/lib', to: 'jojo-bridge', label: 'HTTP long-poll (MCP)', path: 'web/src/lib/mcp-link.ts' },
  { from: 'web/lib', to: 'mobile/lib', label: 'encrypted LAN hand-off', path: 'web/src/lib/handoff-send.ts' },
]

export const FLOW_RULES: readonly FlowRule[] = [
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

export const FLOW_PLACEMENT: readonly FlowQuestion[] = [
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
    a: 'A projection in service/kg/core/project.ts and a hook in service/kg/react. If the assistant should be able to ask for it, add a read module in service/kg/agent/reads/ and register it in READS in service/kg/agent/queries.ts — the order there is the order the model sees.',
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
export function flowMapPaths(): string[] {
  const paths = new Set<string>()
  for (const layer of FLOW_LAYERS) {
    paths.add(layer.path)
    for (const m of layer.modules) paths.add(m.path)
  }
  for (const flow of CONTROL_FLOWS) for (const node of flow.nodes) paths.add(node.path)
  for (const channel of CHANNELS) paths.add(channel.path)
  for (const rule of FLOW_RULES) for (const p of rule.enforcedBy) paths.add(p)
  return [...paths].sort()
}
