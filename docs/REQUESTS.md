# Requests ledger

Every fix and feature the owner has asked for, from the first session (2026-08-07) on,
and the tests that would fail if it broke. Read it before changing behaviour: if a change
makes one of these tests fail, it is undoing something that was asked for.

`service/scripts/check-requests.mjs` runs in the gate. It fails when a request that still
holds names no test (and gives no reason it cannot have one), or when a cited test file is
gone or no longer has a test with that title. A test renamed in a refactor therefore has to
be re-pointed here, which is the moment to check it still guards the same thing.

Statuses: `active` holds today (a `Not yet true:` line names any part that does not
yet hold); `open` was asked for and does not hold yet, awaiting a fix or the owner's
decision; `superseded` was replaced by a later request (named);
`reverted` was undone at the owner's request; `process` was an instruction about how to
work, not a product outcome. `active` requests need a test; an `open` one gets its test
when it is fixed.

Adding a request: give it the next Q-number, the same four lines, and at least one test.


## Assistant, agent and models

### Q059 — Add knowledge graph visualization and query view, and QR based cross-platform sync (transfer) mock.
`feature` · 2026-08-09 · web · active
Must stay true: The /graph route shows the knowledge graph (GraphCanvas) with a query view (QueryPanel/AskBox).
Guarded by:
- `web/src/routes/Graph.requests.test.ts` › "is routed at graph and renders the Graph page"
- `web/src/routes/Graph.requests.test.ts` › "draws the graph canvas and the query panel together"
- `web/src/routes/Graph.requests.test.ts` › "puts the ask-in-words box inside the query panel"

### Q065 — Build manual deterministic functionality: every card is a tool that inserts/updates/deletes records in a knowledge graph stored in IndexedDB as JSON, with modular documented code.
`feature` · 2026-08-09 · service · active
Must stay true: Every card writes through deterministic service tools that insert, update and delete records in the knowledge graph stored in IndexedDB (service/kg/tools).
Guarded by:
- `service/kg/tools/tools.test.ts` › "round-trips every one-field tool"
- `service/kg/tools/tools.test.ts` › "restores an application AND its edges after a delete"
- `service/kg/tools/tools.test.ts` › "creates an application, its employer and its deadline in ONE commit"
- `web/src/kg/storage/idb-driver.test.ts` › "creates all four stores with the indexes the catalogue names"

### Q092 — Local model card uses real vLLM: user points to a vLLM server; model name empty and disabled until Test connection fetches it from the endpoint.
`feature` · 2026-08-22 · cross · superseded
Must stay true: In LocalModelPanel the model name is empty and disabled until Test connection fetches it from the server's GET /v1/models.
Note: Superseded by Q172: the Model field is typeable so NVIDIA ids can be entered; it still fills from a successful Test connection.

### Q093 — Saved model URLs: the model name can be edited or auto-saved under that name; a quick-link icon opens the saved list where entries can be loaded or deleted.
`feature` · 2026-08-22 · cross · active
Must stay true: A connected model is saved under its (editable) name in SavedServers, and the saved list can load or delete an entry.
Guarded by:
- `service/kg/core/model-server.test.ts` › "names a new entry after the model when the user has not named it"
- `service/kg/core/model-server.test.ts` › "renames, and falls back to the model id rather than to nothing"
- `service/kg/core/model-server.test.ts` › "removes by id, so a rename in flight cannot delete the wrong row"
- `service/kg/core/model-server.test.ts` › "keeps the provider and the key alongside the address and model"

### Q101 — With vLLM connected the platform works agentically: every functionality is a tool to the LLM.
`feature` · 2026-08-22 · cross · active
Must stay true: With a model connected, every app function is reachable by the agent as a tool in the service tool CATALOG.
Guarded by:
- `service/kg/agent/catalog.test.ts` › "exposes every catalogued tool in the registry, plus every read"
- `service/kg/agent/catalog.test.ts` › "hides nothing marked only internal"
- `service/kg/agent/loop.test.ts` › "is the whole catalog by default"

### Q102 — Show the agent's tool calls, thinking and replies in the chat thread as they happen (streamed, in order), so the user sees what the agent does in the backend.
`feature` · 2026-08-22 · web · active
Must stay true: The chat thread streams the agent's tool calls (AgentTrace), thinking and reply text as they happen, in call order.
Guarded by:
- `service/kg/agent/loop.requests.test.ts` › "streams thinking, the tool call and the reply text in the order they happened"
- `service/kg/agent/loop.test.ts` › "is reported before the answer, and never sent back to the model"
- `service/kg/agent/loop.test.ts` › "runs a tool and really changes the graph"

### Q103 — All functionalities exposed as MCP tools.
`feature` · 2026-08-22 · bridge · active
Must stay true: Every user-facing function is exposed as an MCP tool through service/kg/agent/mcp.ts (served by jojo-bridge).
Guarded by:
- `service/kg/agent/mcp.test.ts` › "lists every catalogued tool with a schema"
- `service/kg/agent/mcp.test.ts` › "lists everything except the two tools that cannot be undone"
- `service/kg/agent/mcp.test.ts` › "runs a write and actually changes the graph"
- `web/src/lib/mcp-link.test.ts` › "answers the handshake, the tool list and real calls against the live graph"

### Q109 — Ask the graph: natural-language question becomes a generated graph query, executed, result returned by the LLM agent, on all three platforms.
`feature` · 2026-08-22 · cross · active
Must stay true: A natural-language question in Ask the graph (AskBox) becomes a generated graph query, is executed, and the agent answers from its result, on web and phone.
Guarded by:
- `web/src/components/graph/AskBox.requests.test.ts` › "runs the agent with graph.query among the tools it is offered"
- `web/src/components/graph/AskBox.requests.test.ts` › "takes the answer from the settled graph.query step"
- `service/kg/agent/graph-query.test.ts` › "answers in prose, so the model can say it without re-deriving it"
- `service/kg/agent/graph-query.test.ts` › "joins two records named in words, not by id"

### Q111 — Assistant page chat with threads persisted in IndexedDB, resumable, taggable to an application, agentic with tool calls.
`feature` · 2026-08-23 · cross · active
Must stay true: Assistant threads persist in IndexedDB, can be resumed after reload, can be tagged to an application, and run the agent with tool calls.
Guarded by:
- `service/test/coverage.test.ts` › "saves every turn shape and reads them back unchanged"
- `service/test/coverage.test.ts` › "files and unfiles"
- `service/kg/react/use-threads.test.ts` › "survives storing and re-reading every turn shape"
- `service/kg/react/agent-runs.test.ts` › "starts from the stored conversation when it has moved on since this session ran"

### Q113 — Multiple chat threads the user can navigate, open and converse in.
`feature` · 2026-08-23 · cross · active
Must stay true: The Assistant shows a list of threads (ThreadList) the user can switch between and continue.
Guarded by:
- `service/kg/react/agent-runs.test.ts` › "runs two conversations at once, without either noticing the other"
- `service/kg/react/agent-runs.test.ts` › "never lets one conversation’s answer land in another"
- `service/kg/react/use-threads.test.ts` › "rebuilds the thread that changed and keeps the one that did not"
- `web/src/lib/chat-dock.test.ts` › "opens a conversation in front, next to the list"

### Q137 — Chat threads keep running in background when user navigates away or opens another thread.
`fix` · 2026-08-23 · web · active
Must stay true: A chat thread's agent run keeps going when the user opens another thread or leaves the page (react/agent-runs.ts).
Guarded by:
- `service/kg/react/agent-runs.test.ts` › "finishes and reports the thread it was FOR"
- `service/kg/react/agent-runs.test.ts` › "runs two conversations at once, without either noticing the other"
- `service/kg/react/agent-runs.test.ts` › "parks on the run, where anything can answer it"

### Q140 — Stop cancels the chat thread's running process.
`fix` · 2026-08-23 · web · active
Must stay true: Stop aborts the thread's running agent turn and its in-flight model request.
Guarded by:
- `service/kg/react/agent-runs.test.ts` › "tells the app to cancel its request, not just the loop"
- `service/kg/agent/loop.test.ts` › "stops when aborted, without running the next call"
- `service/kg/agent/loop.test.ts` › "stops between two calls of the same turn, not just between rounds"

### Q141 — Approval gate for chat actions such as editing files unless set to auto.
`feature` · 2026-08-23 · web · superseded
Must stay true: n/a (superseded).
Note: The approve-unless-auto gate was reworked into the manual/semi/auto modes (Q207).; from C2-062

### Q142 — Move 'Try one of these' up, fix chat panel height, and beautify JSON in arguments and results.
`change` · 2026-08-23 · web · active
Must stay true: The "Try one of these" openers (OpenerList) sit high in an empty thread, the chat panel height fits its card, and tool-call arguments and results render as pretty-printed JSON.
Guarded by:
- `web/src/components/assistant/Transcript.requests.test.ts` › "pretty-prints a step’s arguments"
- `web/src/components/assistant/Transcript.requests.test.ts` › "pretty-prints a structured result, in a block that keeps the indentation"
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "draws the Assistant’s openers only while there are no entries"

### Q146 — Enable Ollama and cloud providers (Claude/OpenAI/other API keys) as LLM service.
`feature` · 2026-08-23 · service · active
Must stay true: Settings offers Ollama and cloud providers (Anthropic, OpenAI, NVIDIA and others with an API key) besides vLLM as the agent's model.
Guarded by:
- `service/kg/core/provider.requests.test.ts` › "offers Ollama and the cloud providers beside a local vLLM-style server"
- `service/kg/core/provider.requests.test.ts` › "asks every cloud provider for a key, and no local one"
- `service/kg/core/model-server.test.ts` › "sends a bearer token for OpenAI"
- `service/kg/core/model-server.test.ts` › "hands an Anthropic request to the Anthropic builder"

### Q147 — A tool graph acts as guided retriever so the agent picks the right tool without hallucination.
`feature` · 2026-08-23 · service · active
Must stay true: The agent gets its tools through the tool graph (agent/tool-graph.ts, retrieve.ts) rather than the whole catalogue, so it picks from the relevant tools.
Guarded by:
- `service/kg/agent/loop.test.ts` › "narrows a clear request, and still runs what it offered"
- `service/kg/agent/retrieve.test.ts` › "never offers a tool without something that produces what it needs"
- `service/kg/agent/retrieve.test.ts` › "keeps an ordinary request well under a third of the catalogue"
- `service/kg/agent/tool-graph.test.ts` › "runs to a fixpoint rather than one hop"

### Q151 — Automated tool-call tests against the three vLLMs with diverse scenarios, reported on the Tools page.
`feature` · 2026-08-24 · service · active
Must stay true: The benchmark runs tool-call scenarios against the live model endpoints and its results show on the guide Tools page.
Guarded by:
- `web/src/components/guide/bench-payload.test.ts` › "has headline counts that match its own scores"
- `web/src/components/guide/bench-runs.test.ts` › "returns one entry per published row"
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "renders the results tables, the diagrams and the explorer"
- `service/test/bench.test.ts` › "builds without a single step failing"

### Q155 — A robust, comprehensive multi-turn agentic benchmark faithful to real deployment (mock data, long-horizon tasks), scored on tool calls, workflow graph and final state, and re-run across the live models.
`feature` · 2026-08-24 · service · active
Must stay true: The benchmark (service/kg/agent/bench-*.ts, service/bench) has multi-turn, long-horizon cases on mock data, each scored on tool calls, the workflow graph and the final store state.
Guarded by:
- `service/kg/agent/bench-score.test.ts` › "has more than one multi-turn conversation, or it is not multi-turn"
- `service/kg/agent/bench-score.test.ts` › "gives every conversation at least one state check"
- `service/kg/agent/bench-workflow.test.ts` › "is perfect for the right tools in the right order"
- `service/kg/agent/bench-fixtures.test.ts` › "are declared on every endurance case, and only on cases the drive can measure"
- `service/test/bench.test.ts` › "contains exactly what the conversations assume"

### Q161 — Tools guide shows benchmark results and analytical diagrams, a benchmark previewer, with evaluation categories and many more test cases.
`feature` · 2026-08-24 · web · active
Must stay true: The guide Tools page shows benchmark results with analytical charts and a benchmark explorer (BenchExplorer) grouped by evaluation category.
Guarded by:
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "renders the results tables, the diagrams and the explorer"
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "groups the explorer’s cases by evaluation category, each with its blurb"
- `service/kg/agent/bench-score.test.ts` › "gives every group a blurb, since the previewer prints one"

### Q163 — Long text overflows chat container; also remove page-level vertical scroll.
`fix` · 2026-08-24 · web · active
Must stay true: Long chat text wraps inside the message bubble, and the Assistant page has no page-level vertical scroll.
Guarded by:
- `web/src/components/assistant/Transcript.requests.test.ts` › "lets the person’s bubble and the answer break anywhere"
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "measures the row against the viewport, so the page itself does not scroll"

### Q164 — Chat search across user and agent messages, always visible, to find things in past conversations.
`feature` · 2026-08-24 · cross · active
Must stay true: A chat search box is always visible and matches text from both user and agent messages across past threads (thread-search.ts).
Guarded by:
- `web/src/components/assistant/thread-search.test.ts` › "searches BOTH sides of the conversation, and the notes and errors too"
- `web/src/components/assistant/thread-search.test.ts` › "finds a conversation by what was SAID, not only by its title"

### Q169 — NVIDIA build.ai as LLM provider with key and model id.
`feature` · 2026-08-24 · service · active
Must stay true: NVIDIA build is a provider in Settings, taking an API key and a model id.
Guarded by:
- `service/kg/core/provider.test.ts` › "is in the list and speaks the OpenAI shape"
- `service/kg/core/provider.test.ts` › "needs a key, and says where to get one"

### Q170 — Eye icon to show API key in key field.
`feature` · 2026-08-24 · web · active
Must stay true: API key fields have an eye button that shows or hides the key.
Guarded by:
- `web/src/components/common/Field.requests.test.ts` › "turns a password field into text only while shown"
- `web/src/components/common/Field.requests.test.ts` › "draws an eye button that toggles it, named for what it does"
- `web/src/components/common/Field.requests.test.ts` › "is what the model settings use for the API key"

### Q171 — Store NVIDIA/OpenAI/Claude keys securely in the saved model list, and keep every model that connected successfully so the user can switch between them.
`feature` · 2026-08-24 · cross · active
Must stay true: NVIDIA, OpenAI and Claude keys are stored securely with their entries in the saved model list, and every model that connected successfully stays saved and selectable.
Guarded by:
- `service/kg/core/model-server.test.ts` › "keeps the provider and the key alongside the address and model"
- `service/kg/core/model-server.test.ts` › "saves every model reached at one address, so they can be switched between"
- `service/kg/core/model-server.test.ts` › "keeps every NVIDIA model, which is the point of the list"
- `web/src/lib/keys-stay-local.test.ts` › "is not a node type, so a backup cannot serialise one"

### Q172 — NVIDIA test-connection must not reset the form, no GET-with-body error, and re-entering a model key must not falsely show connected.
`fix` · 2026-08-24 · web · active
Must stay true: NVIDIA Test connection keeps the form as filled, sends no GET with a body, and re-entering a key does not show "connected" until a test succeeds.
Guarded by:
- `web/src/components/settings/LocalModelPanel.requests.test.ts` › "keeps the model the person typed when the test fails"
- `web/src/components/settings/LocalModelPanel.requests.test.ts` › "calls the card connected only after a successful test"
- `web/src/components/settings/LocalModelPanel.requests.test.ts` › "forgets the last verdict the moment a key is typed"
- `web/src/lib/reader-relay.test.ts` › "the bridge omits an absent body rather than sending an empty string"
- `web/src/lib/reader-relay.test.ts` › "and the worker never attaches one to a GET, and sends nothing but GET and POST"

### Q181 — The profile pipeline must build a digital-twin graph of the user from the CV, application bucket materials and other provided info, filling missing links, so the agent can assess fit, improvements and tailoring.
`feature` · 2026-08-24 · service · active
Must stay true: The profile pipeline builds a graph of the user (digital twin) from the CV, application-bucket materials and other provided info, filling missing links, and assess/fit reads from it.
Guarded by:
- `service/test/cv-to-graph.test.ts` › "lands in the graph as records the app can query"
- `service/test/cv-to-graph.test.ts` › "changes the answer about a posting, which is the point"
- `service/kg/core/twin.test.ts` › "goes from one gap to none across a read"
- `service/kg/core/twin.test.ts` › "moves on to connecting once the reading is done"

### Q191 — Building a profile from CV failed with 'Nothing answered ... within 60 seconds' though the model sometimes replies; fix it.
`fix` · 2026-08-25 · service · active
Must stay true: Building a profile from a long CV does not fail with "Nothing answered ... within 60 seconds" while the model is still responding (streamed reads, not a fixed 60 s cut-off).
Guarded by:
- `web/src/lib/local-service.requests.test.ts` › "is not cut off while the model keeps producing, however long it runs"
- `web/src/lib/local-service.requests.test.ts` › "still reports a stream that goes quiet for a whole timeout"
- `web/src/lib/llm.test.ts` › "lets a healthy streamed turn through, counts and all"

### Q193 — Parsing a CV must capture education, employment and all other detail in the graph, not only basic profile fields.
`fix` · 2026-08-25 · service · active
Must stay true: Parsing a CV (agent/read-cv*.ts) stores education, employment and the other CV sections in the graph, not only the basic profile fields.
Guarded by:
- `service/kg/agent/read-cv.test.ts` › "keeps every category a real CV states"
- `service/kg/agent/read-cv.test.ts` › "keeps them, because they are what answers a posting"
- `service/kg/agent/read-cv.test.ts` › "covers the whole document across the passes"
- `service/kg/agent/read-cv.test.ts` › "keeps a section nobody in the vocabulary anticipated"

### Q194 — The graph must also be parsed and enriched from research statements, teaching statements and cover letters.
`feature` · 2026-08-25 · service · active
Must stay true: Research statements, teaching statements and cover letters are parsed into the profile graph as well as the CV.
Guarded by:
- `service/kg/core/twin.test.ts` › "offers a research statement and a teaching philosophy"
- `service/kg/core/twin.test.ts` › "offers a master cover letter that is not attached to a job"
- `service/kg/core/twin.test.ts` › "recognises the other documents a person writes about themselves"
- `service/kg/agent/read-cv.test.ts` › "tells a cover letter reader what to TAKE, not only what to leave"

### Q195 — Remove the next-chat suggestions in every chat thread because they overlap the conversation.
`fix` · 2026-08-25 · web · active
Must stay true: Chat threads show no next-message suggestion chips over the conversation.
Guarded by:
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "draws the Assistant’s openers only while there are no entries"
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "does the same on the worked-example panel"
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "does the same in a chat dock window"

### Q196 — Double the chat input box height.
`change` · 2026-08-25 · web · active
Must stay true: The chat Composer input is twice its former default height.
Guarded by: not testable — Pure look-and-feel: "twice the former height" has no baseline left in the tree, and the box was later made fixed-size (h-16, resize-none), which Q200 pins.

### Q197 — Shift+Enter inserts a newline in the chat input.
`feature` · 2026-08-25 · web · active
Must stay true: In the Composer, Shift+Enter inserts a newline and Enter alone sends (shouldSend in composer-keys.ts).
Guarded by:
- `web/src/lib/composer-keys.test.ts` › "does NOT send on Shift+Enter — that is the newline"
- `web/src/lib/composer-keys.test.ts` › "sends on a bare Enter"

### Q198 — In auto mode adding a person failed with 'no tool to call'; auto mode must auto-approve tool calls except delete.
`fix` · 2026-08-25 · service · superseded
Must stay true: n/a (superseded).
Note: Replaced by the three-mode design in M381 (Q207).; from C3-027

### Q199 — Use a detailed taxonomy with an open, flexible ontology (LLM can pick edge types on the fly) and verify before adding a triple that the same information does not already exist under another name.
`feature` · 2026-08-25 · service · active
Must stay true: Relations come from an open taxonomy (the model may coin a Rel), and a triple whose meaning already exists under another relation name is rejected as a duplicate before it is added.
Guarded by:
- `service/kg/tools/claim.test.ts` › "records an unfamiliar relation and marks it as one"
- `service/kg/tools/claim.test.ts` › "refuses the same fact proposed in different words"
- `service/kg/core/claim.test.ts` › "recognises a relation already stored under another verb"
- `service/kg/core/ontology.test.ts` › "keeps a relation nobody enumerated"

### Q200 — Dragging the input box taller must not overlap the chat thread; fix via CSS or separate cards.
`fix` · 2026-08-25 · web · active
Must stay true: Resizing the Composer taller never overlaps the thread: the transcript and input are separate regions.
Guarded by:
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "keeps the transcript scroller from bleeding down under the composer"
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "gives the composer a fixed box with no drag handle"

### Q201 — Decide whether to use LangChain/LangGraph, and implement robust linear and non-linear agent workflows.
`feature` · 2026-08-25 · service · active
Must stay true: Agent workflows, linear and branching, run on the native workflow runner (agent/flow.ts) with retries and timeouts; LangChain/LangGraph is not a dependency.
Guarded by:
- `service/kg/agent/flow.test.ts` › "runs every step in order"
- `service/kg/agent/flow.test.ts` › "follows a conditional edge decided by state"
- `service/kg/agent/flow.test.ts` › "tries again when the step says it is worth it"
- `service/kg/agent/flow.test.ts` › "stops a node retrying past the budget"
- `service/test/flow.requests.test.ts` › "depends on no LangChain or LangGraph package in any workspace"

### Q204 — Context truncation must never delete the instruction prompt.
`feature` · 2026-08-26 · service · active
Must stay true: When history is trimmed or compacted, the system instruction prompt is always kept.
Guarded by:
- `service/kg/agent/loop.test.ts` › "never drops the system message, however small the window"
- `service/kg/agent/budget.test.ts` › "keeps the loop’s own instruction when it has to cut a fresh result"

### Q205 — Add a separate LLM tool-retriever agent that runs independently and in parallel with the chat and returns relevant tools for the request.
`feature` · 2026-08-26 · service · active
Must stay true: A separate model-based tool retriever (agent/retrieve-llm.ts) runs alongside the chat and returns the tools relevant to the request, which narrow the agent's tools.
Guarded by:
- `service/kg/agent/retrieve-llm.test.ts` › "returns the picks when the chooser answers"
- `service/kg/agent/loop.test.ts` › "offers what the chooser picked, closed over and stripped"
- `service/kg/agent/loop.test.ts` › "falls back to the lexicon when the chooser is down"
- `service/kg/agent/retrieve.test.ts` › "never offers LESS than the lexicon would have"

### Q206 — Chat context management for long-horizon chats that exceed one window, with compaction that works for all models.
`feature` · 2026-08-26 · service · active
Must stay true: A thread longer than the model window is compacted (agent/compact.ts, COMPACT_TARGET = 1/3 of the window) so the chat continues on any model, without dropping the system prompt.
Guarded by:
- `service/kg/agent/budget.test.ts` › "lands near a third of the window, not just under the ceiling"
- `service/kg/agent/compact.test.ts` › "sends the summariser the schema, the budget, and only the assistant’s prose"
- `service/kg/agent/loop.test.ts` › "never drops the system message, however small the window"
- `service/kg/react/agent-runs.test.ts` › "reports the summary, the thread it belongs to, and how far it reaches"

### Q207 — Replace the auto-approve toggle with three modes: manual, semi-auto (only destructive operations need approval) and auto (no approval); the tests must type-check against the mode type.
`feature` · 2026-08-26 · service · active
Must stay true: APPROVAL_MODES is exactly manual, semi and auto per conversation: manual asks for every write, semi asks only for destructive tools (effect delete or admin), auto asks for none (except Q312); tests type-check against ApprovalMode.
Guarded by:
- `service/kg/agent/loop.test.ts` › "maps each mode to the gate the loop understands"
- `service/kg/agent/loop.test.ts` › "names a real tool of the stated effect for every row"
- `service/kg/agent/loop.test.ts` › "defaults to stopping for deletions when no mode is given"
- `service/kg/tools/tools.test.ts` › "remembers how much one conversation may do without being asked"

### Q213 — The graph has nodes but no edges; add a separate agent pass that takes batches of nodes and returns all possible triples, covering all nC2 pairs, to connect the profile.
`fix` · 2026-08-27 · service · active
Must stay true: After profile building a separate linking pass (agent/link-profile.ts, link-batches.ts) proposes triples for every node pair in each batch, so the profile graph has edges.
Guarded by:
- `service/kg/agent/link-profile.test.ts` › "puts every pair of facts in front of it at least once"
- `service/kg/agent/link-batches.test.ts` › "is a handful of calls for a CV, not one and not hundreds"
- `service/kg/agent/link-profile.test.ts` › "records one edge when two batches find the same one"

### Q214 — In semi-auto mode on GitHub Pages building a profile fails with invalid JSON args and 'could not reach http endpoint'; plain-http vLLM must be reached via the extension relay as it was before.
`fix` · 2026-08-27 · web · active
Must stay true: On the HTTPS site with the extension installed, a plain-http model endpoint is reached through the extension relay in every approval mode, and tool-call arguments are valid JSON.
Guarded by:
- `web/src/lib/llm.test.ts` › "asks the extension for a LAN address from an https page"
- `web/src/lib/llm.test.ts` › "asks the extension for a STREAMED LAN turn too, from an https page"
- `web/src/lib/reader-relay.test.ts` › "relays every path the app calls on every local server it supports"
- `service/kg/core/model-server.test.ts` › "reads them, instead of running the tool with nothing"

### Q215 — Add Claude Code headless / Claude SDK as an agent provider so the user's Claude subscription can be used.
`feature` · 2026-08-27 · service · superseded
Must stay true: n/a (superseded).
Note: A Claude subscription cannot be a jojo provider (policy); instead Claude Code drives jojo through jojo-bridge over MCP (Q103, Q236).; from C3-044

### Q216 — Fix benchmark instrumentation and scoring: label/key mismatch, invalid-JSON bucket, record finishReason, answer text, no max_tokens, fromHistory, and stop a do-nothing agent scoring correct on read-only turns.
`fix` · 2026-08-27 · service · active
Must stay true: Benchmark scoring (bench-score.ts) matches labels and keys, buckets malformed arguments as invalid JSON, records finishReason and answer text, sets no max_tokens cap, and a do-nothing agent does not score as correct on read-only turns.
Guarded by:
- `service/test/run.requests.test.ts` › "parses malformed tool arguments to null, as production does, never to {}"
- `service/test/run.requests.test.ts` › "sends no max_tokens unless the run asks for one"
- `service/test/run.requests.test.ts` › "keeps each turn’s finish reason and answer text in the report"
- `service/kg/agent/bench-score.test.ts` › "does not let the read-only escape pass a fact-less answer"
- `service/kg/agent/json-schema.test.ts` › "carries the DESCRIPTION only, because the key already names the field"

### Q217 — memory.clear leaves roles and includeAcademia behind; it must clear them.
`fix` · 2026-08-27 · service · active
Must stay true: memory.clear also clears roles and includeAcademia.
Guarded by:
- `service/kg/tools/tools.test.ts` › "leaves nothing personal in the profile"
- `service/kg/tools/tools.test.ts` › "leaves a usable profile, not an empty one"

### Q218 — About six write tools have a describe that does not name the record they change; fix.
`fix` · 2026-08-27 · service · active
Must stay true: Every write tool's announcement names the record it changes (97 write tools measured 2026-11-15); the four that change no single record (pipeline.proposal.clear/sweep, memory.reset/clear) are listed as exempt with a reason.
Guarded by:
- `service/kg/tools/tool.requests.test.ts` › "names the record it changed: "
- `service/kg/tools/tool.requests.test.ts` › "covers the 40 that change one existing record"
- `service/kg/tools/tool.requests.test.ts` › "leaves no write tool in the catalog unnamed or unaccounted for"

### Q219 — Two factually wrong error messages must be corrected.
`fix` · 2026-08-27 · service · active
Must stay true: The two error messages named in the review state their true cause.
Guarded by: not testable — The request does not say which two error messages were wrong (they were in a truncated paste), so there is nothing specific to assert.

### Q220 — toolsFor must preserve the order it is given.
`fix` · 2026-08-27 · service · active
Must stay true: toolsFor (agent/pipelines.ts) returns tools in the order it was given.
Guarded by:
- `service/kg/agent/offer.requests.test.ts` › "comes back in the order the caller asked for, not catalog order"
- `service/kg/agent/offer.requests.test.ts` › "emits each tool once, whichever spelling the caller used for it"

### Q222 — Make the dataset interactive in the Evaluation card: chat input with ground-truth workflow graph (reactflow arrows) and outputs, like the ledger project.
`feature` · 2026-08-27 · web · active
Must stay true: The guide's evaluation card lets the user pick a benchmark case and shows its chat input, the ground-truth workflow graph (React Flow arrows) and expected outputs.
Guarded by:
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "offers the conversation, its workflow and what it expects"
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "shows each turn’s chat input"
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "draws the ground-truth workflow with React Flow"
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "shows the expected outputs"
- `web/src/components/guide/bench-flow.test.ts` › "every one lays out — no cycles, no dangling links"

### Q236 — Help and UI for connecting Claude Code to jojo-bridge fail when claude is not on the PATH, and the web copy says it needs the extension even when installed.
`fix` · 2026-09-11 · bridge · active
Must stay true: The MCP link panel (McpLinkPanel) gives working steps to connect Claude Code to jojo-bridge even when claude is not on the PATH, and does not say the extension is needed when it is installed.
Guarded by:
- `web/src/components/settings/McpLinkPanel.requests.test.ts` › "says what to do when the shell cannot find claude"
- `web/src/components/settings/McpLinkPanel.requests.test.ts` › "asks for the extension only from the status that means it is missing"
- `web/src/lib/mcp-link.test.ts` › "does not accuse the extension of being missing over one dropped poll"
- `web/src/lib/mcp-link.test.ts` › "names the extension once the miss repeats"

### Q246 — Add a reorganize button in the knowledge graph preview.
`feature` · 2026-09-12 · web · active
Must stay true: The knowledge graph preview has a reorganise (re-layout) button.
Guarded by:
- `web/src/routes/Graph.requests.test.ts` › "has a Reorganize button that moves the layout seed on"
- `web/src/routes/Graph.requests.test.ts` › "hands that seed to the canvas"
- `web/src/components/graph/force.test.ts` › "gives a genuinely different arrangement for a different seed"

### Q256 — Agent jobs must not be cancelled when the user changes tabs; all jobs queue with state, finish in the background and notify when complete.
`fix` · 2026-09-13 · cross · active
Must stay true: Agent jobs are not cancelled when the user changes tabs: they queue with state, finish in the background and notify on completion (core/jobs.ts).
Guarded by:
- `service/kg/react/jobs.test.ts` › "keeps running when nothing but the job itself can stop it"
- `service/kg/react/jobs.test.ts` › "holds the second until the first is done, then starts it"
- `service/kg/react/jobs.test.ts` › "carries a failure’s reason to whoever is listening"
- `service/kg/core/jobs.test.ts` › "starts the next the moment a slot frees, in the order they were asked"

### Q285 — Add a LinkedIn-style floating chat card at bottom right to browse threads and chat with the agent, which shifts left beside the application details panel so it never overlaps.
`feature` · 2026-10-10 · web · active
Must stay true: A floating chat dock (ChatDock) at the bottom right lists threads and chats with the agent on every page, and moves left beside the open details panel so the two never overlap.
Guarded by:
- `web/src/components/layout/AppShell.requests-g1.test.ts` › "is mounted by the shell on every page but the Assistant’s own"
- `web/src/components/layout/AppShell.requests-g1.test.ts` › "lays itself out against the open sheet’s width"
- `web/src/lib/chat-dock.test.ts` › "sits beside the sheet, never over it"

### Q290 — Make the chat footer card draggable from the right to center or left so the user can uncover obstructed content.
`feature` · 2026-10-16 · web · active
Must stay true: The chat dock can be dragged from the right to the centre or left and stays where it is dropped.
Guarded by:
- `web/src/lib/chat-dock.test.ts` › "maps a drag to a position, leftward being further from the corner"
- `web/src/lib/chat-dock.test.ts` › "travels from its anchor to just short of the sidebar"
- `web/src/lib/chat-dock.test.ts` › "reads back only a stored number in range, and the corner otherwise"

### Q295 — The graph query toolset cannot perform all queries (e.g. latest/farthest future deadline); audit what is missing so such queries work.
`fix` · 2026-10-22 · service · active
Must stay true: The record query (memory.list in agent/record-query.ts, graph.query) can sort, filter and aggregate by date fields, so questions like the latest or farthest-future deadline return the right record.
Guarded by:
- `service/kg/agent/record-query.test.ts` › "answers "which deadline is furthest away" in one call"
- `service/kg/agent/record-query.test.ts` › "gives the earliest and latest of a date field"
- `service/kg/agent/record-query.test.ts` › "filters on dates relative to today"
- `service/kg/agent/record-query.test.ts` › "puts records without the field last in BOTH directions"

### Q297 — Use the real context window of the models (Gemma, GPT-OSS are far above 6000): stop shortening tool results needlessly, default to 128k, and shrink the budget only when the user sets a smaller value.
`change` · 2026-10-22 · service · active
Must stay true: The default context window is 128k (with the model's real limit honoured, e.g. Gemma 256k), tool results are not shortened while they fit, and the budget shrinks only when the user sets a smaller window.
Guarded by:
- `service/kg/core/provider.requests.test.ts` › "defaults to 128k for a local OpenAI-compatible server"
- `service/kg/core/provider.requests.test.ts` › "takes the person’s own number, smaller or larger, over the default"
- `service/kg/agent/budget.test.ts` › "leaves a conversation that fits with every result intact"
- `service/kg/agent/budget.test.ts` › "leaves a request that already fits completely alone"

### Q300 — The agent harness should loop like Claude: check whether the task is complete and continue until the response is complete, including after stuck/incomplete LLM responses.
`feature` · 2026-10-23 · service · active
Must stay true: The agent loop (agent/loop.ts) checks whether the task is complete and continues after a truncated, stuck or incomplete model response, up to a limit (stuck.ts).
Guarded by:
- `service/kg/agent/loop.test.ts` › "continues an answer cut off at the output limit, and joins the halves"
- `service/kg/agent/loop.test.ts` › "stops continuing after its budget, and says the reply may be incomplete"
- `service/kg/agent/verify-gate.test.ts` › "nudges a bare “Done.”"
- `service/kg/agent/stuck.test.ts` › "tells the model on the third and stops it on the fifth"

### Q301 — Enable reasoning/thinking for models that support it (Gemma, GPT-OSS).
`feature` · 2026-10-23 · service · active
Must stay true: Requests to reasoning-capable models (Gemma, GPT-OSS) enable thinking.
Guarded by:
- `service/kg/core/model-server.test.ts` › "asks a local OpenAI-compatible server to reason, by default"
- `service/kg/core/model-server.test.ts` › "spells the same thing Ollama-native way, and disturbs nothing else"

### Q302 — Show the model's thinking text in the UI.
`feature` · 2026-10-23 · web · active
Must stay true: The model's thinking text is shown in the chat UI.
Guarded by:
- `web/src/components/assistant/Transcript.requests.test.ts` › "draws a thought entry as a ThoughtRow carrying its text"
- `web/src/components/assistant/Transcript.requests.test.ts` › "opens the row to the whole thought"
- `service/kg/agent/loop.test.ts` › "streams through the reasoning callback as it arrives"
- `service/kg/react/use-threads.test.ts` › "is kept for the person and never replayed to the model"

### Q303 — The chat thread list and the chat panel should always share the same height and bottom edge.
`fix` · 2026-10-23 · web · active
Must stay true: On the Assistant page the thread list and the chat panel always have the same height and bottom edge.
Guarded by:
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "caps the row, not one panel, on a desktop"
- `web/src/components/assistant/AgentPanel.requests.test.ts` › "has the thread list fill that row"

### Q304 — Update the FAQ help page with the benchmark results and time-per-token details.
`change` · 2026-10-26 · docs · active
Must stay true: The guide Tools page shows current benchmark results with time-per-token figures (ToolBenchTable, ReasoningTables).
Guarded by:
- `web/src/components/guide/BenchExplorer.requests.test.ts` › "prints milliseconds per token and tokens per second for each row"
- `web/src/components/guide/bench-runs.test.ts` › "reads cost, noise and stops from a payload that carries them"

### Q308 — Application notes cannot be added, edited or deleted via chat; add notes tools and make sure all such app functions are accessible from chat.
`fix` · 2026-11-11 · service · active
Must stay true: The agent has tools to add, edit and delete application notes, and every user-facing record operation is reachable from chat.
Guarded by:
- `service/kg/agent/loop.requests.test.ts` › "adds, edits and deletes the note through the agent"
- `service/kg/agent/catalog.test.ts` › "exposes every catalogued tool in the registry, plus every read"
- `service/kg/tools/tools.test.ts` › "is empty, from either tool that writes a note"

### Q312 — In auto mode, 'reset' and 'clear everything' must always ask; fixes must not cause data loss for live browser user data.
`change` · 2026-11-14 · cross · active
Must stay true: In auto mode, memory.reset and memory.clear (clear everything) still ask for approval, and fixes never lose existing browser user data.
Guarded by:
- `service/kg/agent/loop.test.ts` › "asks before both whole-store tools under every mode, and nothing else is exempt from auto"
- `service/kg/agent/loop.test.ts` › "will not run one the retriever never offered, even with approvals off"
- `service/kg/agent/retrieve.test.ts` › "never offers the two irreversible tools unasked"


## Applications

### Q039 — Kanban board fills full page height.
`change` · 2026-08-08 · web · active
Must stay true: The Applications board fills the full available page height.
Guarded by:
- `web/src/routes/Applications.requests-g2.test.ts` › "caps the board panel at the room left below it and lets it grow into that room"
- `web/src/routes/Applications.requests-g2.test.ts` › "puts the views in a column that takes the rest of the page"

### Q040 — Where they came from defaults to donut; Applications defaults to the kanban view.
`change` · 2026-08-08 · web · active
Must stay true: ApplicationSources defaults to the donut view and Applications defaults to the board (kanban) view, not the table.
Guarded by:
- `web/src/routes/Applications.requests-g2.test.ts` › "defaults the view to the board, not the table"
- `web/src/components/dashboard/ApplicationSources.requests-g2.test.ts` › "starts its view state on the donut"

### Q047 — Applications table fits page height with vertical scrollbar, filters and a table-specific search bar.
`change` · 2026-08-08 · web · active
Must stay true: The applications table fits the page height with its own vertical scroll, filters (ApplicationsFilters) and a table-specific search box.
Guarded by:
- `web/src/routes/Applications.requests-g2.test.ts` › "caps the table panel at the room left below it, so the table scrolls inside it"
- `web/src/routes/Applications.requests-g2.test.ts` › "scrolls the rows under a header that stays put"
- `web/src/routes/Applications.requests-g2.test.ts` › "shows the filters, with a search box and a stage filter for the table"

### Q049 — While dragging a card between phases it must not hide behind the phase column.
`fix` · 2026-08-08 · web · active
Must stay true: A board card being dragged renders above every column, never behind one.
Guarded by:
- `web/src/components/applications/board/ApplicationsBoard.requests.test.ts` › "draws the carried card in a DragOverlay"
- `web/src/components/applications/board/ApplicationsBoard.requests.test.ts` › "renders the overlay outside the scrolling columns"
- `web/src/components/applications/board/ApplicationsBoard.requests.test.ts` › "does not move the card left in its column with the pointer"

### Q118 — Documents card previews are not visible; enable preview and drag and drop of profile documents.
`fix` · 2026-08-23 · web · active
Must stay true: Profile documents in DocumentsPanel preview in the app and accept drag and drop.
Guarded by:
- `web/src/components/profile/DocumentsPanel.requests.test.ts` › "makes the whole list the drop target, filing into the bucket"
- `web/src/components/profile/DocumentsPanel.requests.test.ts` › "opens a tile in the inline viewer with the document’s bytes"
- `web/src/components/profile/DocumentsPanel.requests.test.ts` › "lists the files filed in that bucket"

### Q121 — User can remove a file from the application bucket card.
`feature` · 2026-08-23 · web · active
Must stay true: The user can remove a file from the application bucket card.
Guarded by:
- `web/src/components/profile/DocumentsPanel.requests.test.ts` › "has a delete button on every tile"
- `web/src/components/profile/DocumentsPanel.requests.test.ts` › "deletes through the shared file delete, closing the viewer if it was open"
- `web/src/lib/use-file-delete.test.ts` › "asks the store even when nothing was known to be stored"

### Q184 — Tagging anything to an application bucket triggers the profile update pipeline after prompting the user to allow it; new information is added to the profile.
`feature` · 2026-08-25 · cross · active
Must stay true: Tagging anything to an application bucket asks the user (ProfileUpdateOffer) before running the profile update, and only on approval adds the new information to the profile.
Guarded by:
- `service/kg/core/twin.test.ts` › "takes the bucket as the signal, whatever the file is called"
- `service/kg/core/twin.test.ts` › "offers a document nobody has been asked about yet"
- `service/kg/core/twin.test.ts` › "stops offering the same document once it has been declined"
- `web/src/components/profile/ProfileUpdateOffer.requests.test.ts` › "writes nothing while reading — the profile changes only on confirm"
- `web/src/components/profile/ProfileUpdateOffer.requests.test.ts` › "adds only the entries the person kept"
- `web/src/components/profile/ProfileUpdateOffer.requests.test.ts` › "reads only when the person presses Read it"

### Q185 — Creating a new application calls assess() to evaluate fit and generate tailoring and preparation guidance.
`feature` · 2026-08-25 · service · active
Must stay true: Creating an application calls assess() to evaluate fit and produce tailoring and preparation guidance.
Guarded by:
- `web/src/components/applications/dialog/use-application-writes.requests.test.ts` › "starts the read from the create path, once the record is written"
- `web/src/components/applications/dialog/use-application-writes.requests.test.ts` › "skips only what could not be measured: no posting, no model, no background"
- `service/test/posting-to-guidance.test.ts` › "produces advice whose every line points at a record or a requirement"
- `service/kg/core/fit-request.test.ts` › "uses the cache even though this record has never asked"

### Q238 — Do not warn about a duplicate just because the domain matches; only for same URL or same title and employer.
`fix` · 2026-09-12 · web · active
Must stay true: A duplicate warning fires for the same URL or the same title and employer, never just because the domain matches.
Guarded by:
- `service/kg/core/duplicates.test.ts` › "tells two postings apart when the board puts the job id in the query"
- `service/kg/core/duplicates.test.ts` › "catches the same posting URL"
- `service/kg/core/duplicates.test.ts` › "catches the same employer and role typed again"
- `service/kg/core/duplicates.test.ts` › "does not fire on an employer alone"

### Q240 — The card drag handle should be a full-height bar on the left with text starting from the top.
`change` · 2026-09-12 · web · active
Must stay true: Each board card has a full-height drag bar on its left, and the card text starts at the top.
Guarded by:
- `web/src/components/applications/board/BoardCard.requests.test.ts` › "pins the handle to the whole left edge, top to bottom"
- `web/src/components/applications/board/BoardCard.requests.test.ts` › "draws its grip dots down the whole height of the bar"
- `web/src/components/applications/board/BoardCard.requests.test.ts` › "leaves the rail a gutter and starts the card text at the top"

### Q244 — How you fit says no copy is stored; uploaded application materials should be read automatically into the knowledge graph so the fit analysis works.
`fix` · 2026-09-12 · service · active
Must stay true: Uploaded application materials are read into the knowledge graph automatically, so How you fit (FitPanel) works without saying no copy is stored.
Guarded by:
- `web/src/lib/vault-blobs.requests-g2.test.ts` › "hands back the bytes of a document asked for while the index is still empty"
- `service/kg/core/twin.test.ts` › "believes the caller about bytes over the record, because the web writes no flag"
- `web/src/lib/file-input.test.ts` › "returns the files, and the input is clear afterwards"
- `web/src/lib/read-here.test.ts` › "reads a saved page as its text, however large its inlined assets"

### Q245 — Gemma does not call tools to update an existing profile; provide a way to update it.
`fix` · 2026-09-12 · service · active
Must stay true: The user can update an existing graph profile (re-read materials through the profile update offer), and it completes on models that call tools poorly, such as Gemma.
Guarded by:
- `service/kg/react/use-read-cv.requests.test.ts` › "completes against a model that only answers in text"
- `service/kg/react/use-read-cv.requests.test.ts` › "offers the model no tools on any turn it takes"
- `service/kg/react/profile-read-request.test.ts` › "holds the request until it is cleared"
- `service/kg/core/twin.test.ts` › "lists any stored document that is not plainly an employer"

### Q247 — Add a re-run button to the How you fit card, built as a full product feature.
`feature` · 2026-09-12 · web · active
Must stay true: The How you fit card (FitPanel) has a re-run button that runs the fit again and replaces the stored reading.
Guarded by:
- `web/src/components/applications/detail/FitPanel.requests.test.ts` › "has a Re-run item wired to the hook’s rerun"
- `service/kg/core/fit-request.test.ts` › "re-reads a cached posting when the person asks again"
- `service/kg/tools/fit.test.ts` › "replaces a reading rather than merging with it"

### Q248 — Closing the application panel must not reset board scroll to top.
`fix` · 2026-09-12 · web · active
Must stay true: Opening and closing the application details panel keeps the board's scroll position.
Guarded by:
- `web/src/lib/links.test.ts` › "gives the list and an open record the same key, so nothing is rebuilt"
- `web/src/lib/links.test.ts` › "keeps the page when a record opens over the list, and when it closes"
- `web/src/components/layout/AppShell.requests-g2.test.ts` › "does not scroll to the top when the record opened or closed over the same page"
- `web/src/components/layout/AppShell.requests-g2.test.ts` › "does not rebuild the page under the record, so the columns keep their own scroll"

### Q249 — On add, check duplicates by posting ID, else title and organization via LLM, and show a modal with the original posting to confirm or discard.
`feature` · 2026-09-12 · web · active
Must stay true: On add, a duplicate is found by posting ID, then URL, then title and organisation via the model judge (judge-duplicate.ts), and a confirm dialog shows the original posting to keep or discard the new one.
Guarded by:
- `service/kg/react/use-duplicate-check.requests.test.ts` › "takes the posting ID over a URL that matches a different record"
- `service/kg/react/use-duplicate-check.requests.test.ts` › "takes the URL next, and then the title and organisation, without asking the model"
- `service/kg/react/use-duplicate-check.requests.test.ts` › "asks the model judge only when the arithmetic found nothing, about the same employer"
- `service/kg/react/use-duplicate-check.requests.test.ts` › "saves without asking when no model is connected or nobody at that employer is on file"
- `web/src/components/applications/ApplicationDialog.requests.test.ts` › "holds the save on a hit and shows the confirm stage instead"
- `web/src/components/applications/ApplicationDialog.requests.test.ts` › "shows the original record, its posting ID and its URL"
- `web/src/components/applications/ApplicationDialog.requests.test.ts` › "lets the person discard the new one or keep it"
- `service/kg/agent/judge-duplicate.test.ts` › "takes a position it offered, at a confidence that means yes"

### Q250 — Persist How you fit results with the application so refresh does not re-run, until the user deletes it.
`fix` · 2026-09-13 · service · active
Must stay true: The How you fit reading is stored on the application's posting (fit.reading.set) and shown after reload without re-running, until the user clears it (fit.reading.clear).
Guarded by:
- `service/kg/tools/fit.test.ts` › "stores what the model read, with the model that read it and when"
- `service/kg/core/fit-request.test.ts` › "uses the cache rather than asking"
- `service/kg/core/fit-request.test.ts` › "does not read a posting somebody has cleared"
- `service/kg/tools/fit.test.ts` › "empties the answer and marks it, rather than deleting the reading"

### Q251 — Add a Preview button on files in From the vault that opens the preview modal instead of going to Vault.
`feature` · 2026-09-13 · web · active
Must stay true: Files in the application's From the vault list have a Preview button that opens the preview dialog in place rather than going to the Vault.
Guarded by:
- `web/src/components/applications/detail/FiledPanel.requests.test.ts` › "offers a Preview button on every file row that sets the previewed file"
- `web/src/components/applications/detail/FiledPanel.requests.test.ts` › "opens the preview dialog on the record, and closes it there"

### Q253 — Add a tailor-materials feature below How you fit that generates modified CV, statements and cover letter as snippets with bold/italic/underline marks, saved with the application and deletable.
`feature` · 2026-09-13 · service · active
Must stay true: Below How you fit, Tailor materials writes a tailored CV, statements and cover letter as snippets with bold/italic/underline marks, saved under the application and deletable (tailor-agent.ts, agent/tailor-material.ts).
Guarded by:
- `web/src/routes/ApplicationDetail.requests.test.ts` › "renders the tailored materials card straight after the fit card"
- `service/kg/tools/tailor.test.ts` › "files a snippet under the application with where it came from written on it"
- `service/kg/tools/tailor.test.ts` › "goes through the ordinary snippet delete, with its undo"
- `service/kg/agent/tailor-material.test.ts` › "forbids invention in as many words, and names the four marks"

### Q254 — Show tailored materials as cards without content; Preview opens the snippet modal.
`change` · 2026-09-13 · web · active
Must stay true: Tailored materials show as cards without their content (TailoredPanel), and Preview opens the snippet preview dialog.
Guarded by:
- `web/src/components/applications/detail/TailoredPanel.requests.test.ts` › "never prints the tailored body on the card"
- `web/src/components/applications/detail/TailoredPanel.requests.test.ts` › "opens the snippet from a Preview button and from the title"
- `web/src/components/applications/detail/TailoredPanel.requests.test.ts` › "previews in the snippet preview dialog"

### Q257 — Put the document description in a second row so it is not hidden under the title.
`fix` · 2026-09-13 · web · active
Must stay true: A tailored document's description sits on its own second row, not under the title.
Guarded by:
- `web/src/components/applications/detail/TailoredPanel.requests.test.ts` › "puts the provenance line after the title row closes, as the card’s own row"

### Q260 — Kanban cards must not show application notes.
`change` · 2026-09-14 · web · active
Must stay true: Board cards do not show application notes.
Guarded by:
- `web/src/components/applications/board/BoardCard.requests.test.ts` › "never reads the note off the record it draws"

### Q262 — Add a checklist card per application, agent-generated from the posting and materials, with user-added items, delete and checkboxes.
`feature` · 2026-09-14 · web · active
Must stay true: Each application has a checklist card (ChecklistPanel) generated by the agent from the posting and materials, where the user can add, tick and delete items.
Guarded by:
- `web/src/routes/ApplicationDetail.requests.test.ts` › "lets the agent draft it, and the person add, tick and delete steps"
- `service/kg/tools/checklist.test.ts` › "ADDS to a list somebody is working through, and never replaces it"
- `service/kg/core/checklist.test.ts` › "stamps the day it was ticked"
- `service/kg/core/checklist.test.ts` › "keeps the order of what is left"
- `service/kg/agent/draft-checklist.test.ts` › "reads a plain list"

### Q264 — When an application moves between Kanban stages, record the date of each stage transition, show it in the details panel (e.g. Submitted on), and let the user edit those dates manually.
`feature` · 2026-09-14 · web · active
Must stay true: Moving an application to a stage records that stage's date (stageDates), StageDatesPanel shows it (e.g. Submitted on), and a manual edit persists and is not overwritten by later moves.
Guarded by:
- `service/kg/tools/tools.test.ts` › "dates the stage it moved to with the day of the move"
- `service/kg/tools/tools.test.ts` › "leaves a date it already has, however many times it is moved back"
- `service/kg/core/stage-dates.test.ts` › "still overwrites when the person gives the date"
- `web/src/routes/ApplicationDetail.requests.test.ts` › "shows each stage’s date, submitted included"
- `web/src/routes/ApplicationDetail.requests.test.ts` › "writes a typed date through the rule that overwrites"

### Q266 — Tailored materials should only consider User Profile Documents and the Vault's Applications bucket documents.
`change` · 2026-09-14 · service · active
Must stay true: Tailoring reads only the profile documents (PROFILE_DOCUMENTS) and the Vault Applications-bucket documents.
Guarded by:
- `service/kg/core/tailoring.test.ts` › "profile documents — the Applications bucket"
- `service/kg/core/tailoring.test.ts` › "never offers a job posting"

### Q269 — Make the right-side application details panel resizable by dragging its edge, with the current width as the minimum and a maximum limit.
`feature` · 2026-09-14 · web · active
Must stay true: The application details panel can be resized by dragging its edge (SheetResizer), clamped between the default width and a maximum (clampSheetWidth in sheet-width.ts).
Guarded by:
- `web/src/lib/sheet-width.test.ts` › "pulls a narrow one up to the minimum"
- `web/src/lib/sheet-width.test.ts` › "pulls a wide one down to what the screen allows"
- `web/src/lib/sheet-width.test.ts` › "measures from the pointer to the right edge, because the sheet is anchored right"
- `web/src/components/applications/detail/DetailSheet.requests.test.ts` › "opens at the minimum width, which is also what a reset returns to"
- `web/src/components/applications/detail/DetailSheet.requests.test.ts` › "clamps a stored width to what this screen allows"

### Q270 — Add a small drawer-handle in the center of the panel edge: a thin vertical capsule with a 2x4 grid of grip dots, so it reads as draggable.
`change` · 2026-09-14 · web · active
Must stay true: The resize handle is a thin vertical capsule with a 2x4 grid of grip dots centred on the panel edge.
Guarded by:
- `web/src/components/applications/detail/SheetResizer.requests.test.ts` › "is a vertical capsule, taller than it is wide"
- `web/src/components/applications/detail/SheetResizer.requests.test.ts` › "is centred on the panel edge, top to bottom and side to side"
- `web/src/components/applications/detail/SheetResizer.requests.test.ts` › "holds two columns of four dots"

### Q272 — Add padding above the title card in the application details right panel so it does not start flush at the top.
`fix` · 2026-09-14 · web · active
Must stay true: The application details panel has top padding above the title card.
Guarded by:
- `web/src/components/applications/detail/DetailSheet.requests.test.ts` › "pads the top of the panel at every width"

### Q274 — The 'Download Every document' action should produce a single zip, not separate downloads.
`fix` · 2026-10-04 · web · active
Must stay true: Download every document produces one zip archive containing every document (buildArchive in document-archive.ts).
Guarded by:
- `web/src/components/settings/DocumentsPanel.requests.test.ts` › "saves exactly once, and what it saves is the archive of every entry"
- `web/src/components/settings/DocumentsPanel.requests.test.ts` › "saves nothing inside a loop over the documents"
- `web/src/lib/document-archive.test.ts` › "round-trips every document byte for byte, under the names given"

### Q275 — Closing an application opened from the table view must keep the table's filter, search and scroll position instead of resetting.
`fix` · 2026-10-04 · web · active
Must stay true: Closing an application opened from the table keeps the table's filter, search text and scroll position (list-query.ts).
Guarded by:
- `web/src/lib/links.test.ts` › "keeps every filter the list reads"
- `web/src/lib/links.test.ts` › "keeps the page when a record opens over the list, and when it closes"
- `web/src/components/layout/AppShell.requests-g2.test.ts` › "does not scroll to the top when the record opened or closed over the same page"
- `web/src/components/layout/AppShell.requests-g2.test.ts` › "does not rebuild the page under the record, so the columns keep their own scroll"

### Q277 — In the Kanban card, the add-tag (+) control should sit after the last tag capsule on the same row, not wrap to the next row.
`fix` · 2026-10-04 · web · active
Must stay true: On a board card the add-tag (+) control sits right after the last tag on the same row and does not wrap to a new row.
Guarded by:
- `web/src/components/applications/detail/DetailHeader.requests.test.ts` › "dissolves the capsules’ own box so they are items of the row, then puts the picker next"

### Q279 — Allow tagging a person as point of contact or recommender on an application from its open details card.
`feature` · 2026-10-04 · web · active
Must stay true: From an open application's details (PeoplePanel) the user can tag a person as point of contact or recommender, and the link persists.
Guarded by:
- `service/kg/tools/tools.test.ts` › "names a person on one job with a role, leaving their other jobs alone"
- `service/kg/tools/tools.test.ts` › "creates a person already named on a job with a role, in one write"
- `web/src/components/applications/detail/PeoplePanel.requests.test.ts` › "files someone already in the Vault on this application with the chosen role"
- `web/src/components/applications/detail/PeoplePanel.requests.test.ts` › "has exactly the two roles to choose from"
- `web/src/components/applications/detail/PeoplePanel.requests.test.ts` › "is on the open application"

### Q283 — A person's name is barely visible because of the affiliation; show the name up to a fixed character count, then the affiliation.
`fix` · 2026-10-10 · web · active
Must stay true: In the details people list, a person's name shows in full up to a fixed character count before the affiliation, which is truncated first.
Guarded by:
- `web/src/components/applications/detail/PeoplePanel.requests.test.ts` › "caps the name at a fixed character width, never shrinking it below that"
- `web/src/components/applications/detail/PeoplePanel.requests.test.ts` › "lets the affiliation take what is left and truncate first"

### Q284 — All entered fields must be visible in application details (e.g. job id is missing).
`fix` · 2026-10-10 · web · active
Must stay true: Every field the user filled in, job id included, is shown in the application details.
Guarded by:
- `web/src/components/applications/detail/DetailFacts.requests.test.ts` › "knows where every form field is shown, and no field is left out"
- `web/src/components/applications/detail/DetailFacts.requests.test.ts` › "shows %s"

### Q296 — The application deadline category is not visible at the top of application details; show it.
`fix` · 2026-10-22 · web · active
Must stay true: The application's deadline category shows at the top of its details (DetailHeader).
Guarded by:
- `web/src/components/applications/deadline.requests.test.ts` › "is the deadline the application form set"
- `web/src/components/applications/deadline.requests.test.ts` › "is not an offer’s respond-by date, nor an interview"
- `web/src/components/applications/detail/DetailHeader.requests.test.ts` › "is handed the application deadline by the details page"
- `web/src/components/applications/detail/DetailHeader.requests.test.ts` › "draws it as a chip in the row with the stage, under the title"

### Q298 — Prefilled suggested background form values look like real entered data; dim them or otherwise make them clearly placeholders.
`change` · 2026-10-22 · web · active
Must stay true: Suggested values prefilled in the profile background forms are styled as placeholders, visibly distinct from entered values.
Guarded by:
- `web/src/components/ui/input.requests.test.ts` › "draws its placeholder in the placeholder colour, in italics"
- `web/src/components/ui/input.requests.test.ts` › "gives the placeholder a colour of its own in both themes, not the value colour"
- `web/src/components/ui/input.requests.test.ts` › "is what the background forms are built from"


## Job Scout, capture and the extension

### Q043 — Reduce carousel height and add a URL textbox with Add application button above it for quick start.
`feature` · 2026-08-08 · web · active
Must stay true: The Dashboard has a URL box with an "Add application" button at the top, above the "Needs a decision" deck, using the shared AddByUrl component (the same From-link flow as /applications). Restored 2026-11-15 after it was dropped on 2026-08-09 without the owner asking.
Guarded by:
- `web/src/routes/Dashboard.requests.test.ts` › "uses the shared AddByUrl component, not a copy"
- `web/src/routes/Dashboard.requests.test.ts` › "renders the URL box above the needs-a-decision deck"
- `web/src/routes/Dashboard.requests.test.ts` › "keeps the button reading Add application, on one slim row"
- `web/src/components/applications/add-by-url.requests.test.ts` › "starts the From link read on the pasted address when a model is connected"

### Q045 — Add the same URL textbox beside Add application button on the Applications page.
`feature` · 2026-08-08 · web · active
Must stay true: The Applications page has the same URL box beside its Add application button (AddByUrl).
Guarded by:
- `web/src/routes/Applications.requests.test.ts` › "uses the shared AddByUrl component"
- `web/src/routes/Applications.requests.test.ts` › "puts it in the header actions, immediately before the New application button"
- `web/src/components/applications/add-by-url.requests.test.ts` › "starts the From link read on the pasted address when a model is connected"

### Q094 — When a job URL is added to an application, save the page HTML and open it later in an in-app preview (it showed "No preview for this type").
`feature` · 2026-08-22 · cross · active
Must stay true: Adding a job URL to an application stores the page as HTML with the application, and the saved page opens in the in-app preview rather than "No preview for this type", on web and phone.
Guarded by:
- `web/src/lib/posting-agent.requests.test.ts` › "is a page record in the postings drawer, named as an .html file, with its address"
- `web/src/lib/posting-agent.requests.test.ts` › "stores an HTML document holding the posting, escaped, every line kept"
- `web/src/lib/posting-agent.requests.test.ts` › "opens in the page preview, not "No preview for this type""
- `web/src/components/applications/AddFromLinkDialog.requests.test.ts` › "adds the new record to the page’s filing, inside the create’s Undo"
- `mobile/src/lib/posting-agent.requests.test.ts` › "saves the page as an HTML page record in the postings drawer, with its bytes on disk"
- `mobile/src/lib/posting-agent.requests.test.ts` › "files the kept page under the application the sheet creates"
- `mobile/src/lib/posting-agent.requests.test.ts` › "offers to read a kept page in the app instead of handing it to another one"
- `web/src/components/vault/file-preview.test.ts` › "keeps PDFs and pages on their own paths, and has nothing for a .docx"
- `web/src/lib/posting-agent.test.ts` › "takes the record back out when the bytes did not, so a retry can fetch it"

### Q110 — User can install the browser extension from the app (reuse the extension and build it) without the store.
`feature` · 2026-08-22 · extension · active
Must stay true: Settings (CaptureExtensionPanel) offers the browser extension built from web/extension for install without a store.
Guarded by:
- `web/src/components/settings/CaptureExtensionPanel.requests.test.ts` › "offers the packed extension as a download in the capture panel"
- `web/src/components/settings/CaptureExtensionPanel.requests.test.ts` › "mounts that panel on the Settings page"
- `web/src/components/settings/CaptureExtensionPanel.requests.test.ts` › "packs the zip from the repo’s own extension folder into public/"
- `web/src/components/settings/CaptureExtensionPanel.requests.test.ts` › "packs it before every dev server and every build"

### Q115 — Use Microsoft MarkItDown so the agent can read PDF/PPT etc. files, with license-compliant attribution.
`feature` · 2026-08-23 · cross · active
Must stay true: The agent reads PDF/PPT and other documents through Microsoft MarkItDown, and MarkItDown is credited with its licence (credits.ts).
Guarded by:
- `service/kg/agent/markitdown.test.ts` › "carries the notice the licence asks for, next to the setting"
- `service/kg/agent/markitdown.test.ts` › "calls the one tool markitdown-mcp exposes, by its exact name"
- `service/kg/agent/documents.test.ts` › "sends a PDF and a legacy .doc to MarkItDown instead"
- `web/src/components/settings/DocumentReaderPanel.requests.test.ts` › "renders the copyright and the licence beside the setting"

### Q119 — Extension-saved job postings must not appear in the application bucket; only user-added/tagged docs there; postings live in Vault under Job posting.
`change` · 2026-08-23 · cross · active
Must stay true: Pages saved by the extension go to Vault under Job postings and never join an application bucket on their own; only documents the user adds or tags appear there.
Guarded by:
- `web/src/lib/file-capture.test.ts` › "is filed under NO application, however well the address matches one"
- `web/src/lib/file-capture.test.ts` › "goes in the postings drawer rather than among the documents you wrote"

### Q126 — Pipeline 1 keeps the knowledge graph up to date (notes, links, tags, emails, study plans), each action as an approval card, with an auto mode that runs and logs.
`feature` · 2026-08-23 · cross · active
Must stay true: Pipeline 1 proposes knowledge-graph updates (notes, links, tags, emails, study plans) as approval cards, and in auto mode runs them and logs each action.
Guarded by:
- `service/kg/react/use-pipelines.requests.test.ts` › "turns a write into an approval card when the twin is not auto, and logs it as suggested"
- `service/kg/react/use-pipelines.requests.test.ts` › "runs the write itself in auto mode, and logs it as applied"
- `service/kg/core/proposal.test.ts` › "lets a twin write notes and tags"
- `service/kg/react/use-pipelines.test.ts` › "tells an auto twin that its writes land and can be undone"

### Q127 — Pipeline 2 scouts relevant postings from profile and search links, dedupes, adds to the review queue only, never auto-adds, and suggests tailoring.
`feature` · 2026-08-23 · cross · active
Must stay true: Pipeline 2 scouts postings from the profile and search links, deduplicates them, and only adds them to the review queue; it never creates an application on its own, and it suggests tailoring.
Guarded by:
- `service/kg/react/use-pipelines.requests.test.ts` › "queues a found posting for approval even when the scout is stored as auto"
- `service/kg/agent/pipelines.requests.test.ts` › "asks for the tailoring each posting would need, from the profile and the saved searches"
- `service/kg/agent/pipelines.requests.test.ts` › "is told the same thing whether or not the pipeline is marked auto"
- `service/kg/core/proposal.test.ts` › "refuses a scout everything that is not its own inbox"
- `service/kg/core/proposal.test.ts` › "is offered to the twin and never to the scout"
- `service/kg/agent/pipelines.test.ts` › "gives a scout the reads it needs to dedupe, and two writes"
- `service/kg/agent/pipelines.test.ts` › "refuses one it has already proposed but nobody has answered yet"

### Q128 — Pipelines are started from the Pipelines card toggle and keep running; when nothing is left a modal offers to shut down and toggles off on approval.
`feature` · 2026-08-23 · cross · active
Must stay true: Pipelines start from the PipelinesPanel toggle and keep running; when nothing is left a ShutdownDialog offers to stop, and approval turns the toggle off.
Guarded by:
- `service/kg/react/use-pipelines.requests.test.ts` › "offers it for an enabled pipeline with nothing left to do"
- `service/kg/react/use-pipelines.requests.test.ts` › "does not offer it while that pipeline still has suggestions waiting"
- `service/kg/react/use-pipelines.requests.test.ts` › "does not offer it while a round is running, nor for one already off"
- `service/kg/react/use-pipelines.requests.test.ts` › "does not offer it after one empty round, only two"
- `web/src/routes/JobScout.requests.test.ts` › "passes the engine’s accept and dismiss to the ShutdownDialog the page mounts"
- `web/src/routes/JobScout.requests.test.ts` › "switches the offered pipeline off through the same enable tool the toggle uses"
- `service/kg/core/proposal.test.ts` › "keeps a working pipeline working, whatever its schedule says"

### Q131 — +New adds 'application from link' when an LLM agent is connected: paste a URL, agent parses and saves the page and prefills the form; M275 asks to do it for mobile.
`feature` · 2026-08-23 · cross · active
Must stay true: With a model connected, +New offers "From link" (AddFromLinkDialog): the agent reads the pasted URL, saves the page and prefills the application form, on web and phone.
Guarded by:
- `web/src/lib/create-actions.requests.test.ts` › "offers it, opening the From link dialog, when a model is connected"
- `web/src/lib/create-actions.requests.test.ts` › "leaves it out without a model, and keeps the plain New application"
- `web/src/components/applications/add-by-url.requests.test.ts` › "starts the From link read on the pasted address when a model is connected"
- `web/src/components/applications/add-by-url.requests.test.ts` › "opens the create form with a guess from the address when none is"
- `web/src/components/applications/AddFromLinkDialog.requests.test.ts` › "opens the create form from the model’s draft, carrying the kept page"
- `mobile/src/lib/create-actions.requests.test.ts` › "has a + menu row for it that only shows with a model"
- `mobile/src/lib/create-actions.requests.test.ts` › "starts the read from the paste row when a model is connected"
- `mobile/src/lib/create-actions.requests.test.ts` › "opens the create sheet from the model’s draft, carrying the kept page"

### Q139 — Extension uses the jojo favicon and is compiled into packages.
`change` · 2026-08-23 · extension · active
Must stay true: The extension's icons are the jojo favicon and the extension is built into an installable package.
Guarded by:
- `web/src/lib/make-extension-icons.requests.test.ts` › "names an icon at every size, for the toolbar and the extensions page alike"
- `web/src/lib/make-extension-icons.requests.test.ts` › "ships icons that are exactly the mark, painted on the favicon’s rounded plate"
- `web/src/lib/make-extension-icons.requests.test.ts` › "draws the mark in the favicon’s own colours"
- `web/src/components/settings/CaptureExtensionPanel.requests.test.ts` › "packs it before every dev server and every build"

### Q168 — Make MarkItDown reachable from deployed HTTPS page by routing via extension to localhost.
`fix` · 2026-08-24 · extension · active
Must stay true: The deployed HTTPS site reaches the local MarkItDown reader through the extension relay (reader-relay) instead of calling localhost directly.
Guarded by:
- `web/src/lib/markitdown.test.ts` › "gives the signal to every hop of the read, handshake included"
- `web/src/lib/reader-relay.test.ts` › "handles the read verb in the worker"
- `web/src/lib/reader-relay.test.ts` › "refuses anything that is not this machine"

### Q173 — MarkItDown should show connected without a refresh.
`fix` · 2026-08-24 · web · active
Must stay true: The MarkItDown reader shows connected as soon as it is reachable, without a page refresh.
Guarded by:
- `web/src/lib/reader-relay.test.ts` › "injects on install, using the manifest’s own patterns"
- `web/src/lib/capture-bridge.test.ts` › "waits for a cold worker when the bridge has marked the page"

### Q178 — Clicking the browser icon opens a menu for extension operations: capture the page, list captured pages and delete from that list.
`feature` · 2026-08-24 · extension · active
Must stay true: Clicking the extension icon opens a popup that can capture the page, lists captured pages, and deletes an entry from the list.
Guarded by:
- `web/src/lib/popup-wiring.test.ts` › "Q178 lists each kept page, and its × deletes that entry from the list"
- `web/src/lib/popup-wiring.test.ts` › "keeps the tab it was opened over, though the button was wired before it was known"

### Q179 — The same popup menu shows MCP server status with enable/disable and routing, and routing of the NVIDIA API.
`feature` · 2026-08-24 · extension · active
Must stay true: The extension popup shows MCP server status with enable/disable and routing, and routing of the NVIDIA API.
Guarded by:
- `web/src/lib/popup-wiring.test.ts` › "Q179 switches the document reader on and shows whether it answers"
- `web/src/lib/popup-wiring.test.ts` › "Q179 lists NVIDIA among the model providers, and its switch stops routing to it"

### Q211 — The agent can only read the first page of a long CV; make it read full documents by paging via MarkItDown.
`fix` · 2026-08-26 · service · active
Must stay true: The agent reads a long document past its first page by paging through the MarkItDown text (agent/paging.ts).
Guarded by:
- `service/kg/agent/paging.test.ts` › "reads a three-window document to the end, one call at a time"
- `service/kg/agent/paging.test.ts` › "names the exact call that reads the next part"

### Q225 — Show the markitdown-mcp install and run commands in a box with a copy icon.
`change` · 2026-09-06 · web · active
Must stay true: Settings shows the markitdown-mcp install and run commands in a box with a copy button (CopyButton).
Guarded by:
- `web/src/components/settings/DocumentReaderPanel.requests.test.ts` › "builds the box text from the install and the run command, one per line"
- `web/src/components/settings/DocumentReaderPanel.requests.test.ts` › "shows that text and copies that same text, side by side"

### Q228 — Suggestions already pending or already in the system must not be added again.
`fix` · 2026-09-06 · web · active
Must stay true: The scout skips a suggestion that is already pending or already an application.
Guarded by:
- `service/kg/agent/pipelines.test.ts` › "refuses one it has already proposed but nobody has answered yet"
- `service/kg/agent/pipelines.test.ts` › "refuses one the person has already applied to"
- `service/kg/agent/pipelines.test.ts` › "recognises a saved posting under a different spelling of its link"

### Q232 — From Link must read the full page with the connected LLM, fill the form and save the page via the extension tagged with the posting.
`fix` · 2026-09-11 · web · active
Must stay true: From Link reads the full page with the connected model, fills the form, and saves the page through the extension filed under that posting.
Guarded by:
- `web/src/lib/posting-agent.requests.test.ts` › "files the extension’s capture through the capture inbox’s own hook"
- `web/src/lib/posting-agent.requests.test.ts` › "keeps the page before the model is asked, and hands its id back with the draft"
- `web/src/components/applications/AddFromLinkDialog.requests.test.ts` › "opens the create form from the model’s draft, carrying the kept page"
- `web/src/components/applications/AddFromLinkDialog.requests.test.ts` › "adds the new record to the page’s filing, inside the create’s Undo"
- `web/src/lib/capture-page.test.ts` › "opens it in the background and hands the whole page back"
- `web/src/lib/capture-bridge.test.ts` › "says the extension is ABSENT when nothing answers, so the caller may use the reader"

### Q233 — Keep Page must save the webpage as one self-contained HTML file including CSS and JS.
`fix` · 2026-09-11 · extension · active
Must stay true: Keep Page saves the page as one self-contained HTML file with its CSS and scripts inlined (capture-serialise).
Guarded by:
- `service/kg/core/capture.test.ts` › "refuses a capture that still points at the site it came from"
- `web/src/lib/capture-assets.test.ts` › "still inlines an ordinary sheet, cap or no cap"
- `web/src/lib/capture-save.test.ts` › "keeps the page and names where and when it came from"
Note: Scripts are stripped from a kept page, not inlined, on purpose: any script in a saved page could reach the network when viewed (round-3 security fix the owner approved). CSS and images are inlined as asked.

### Q235 — Keeping a HigherEdJobs posting fails with 'That page is too big to keep'; fix.
`fix` · 2026-09-11 · extension · active
Must stay true: Keeping a large page such as a HigherEdJobs posting succeeds instead of failing with "That page is too big to keep" (capture-shrink).
Guarded by:
- `web/src/lib/capture-page.test.ts` › "keeps a page over the cap by leaving out its heaviest fonts — the HigherEdJobs case"
- `web/src/lib/capture-shrink.test.ts` › "saves a page that is over by a sliver instead of discarding it"

### Q239 — The same URL posting HTML must not be associated with two applications.
`fix` · 2026-09-12 · web · active
Must stay true: A saved posting page for one URL is filed under at most one application.
Guarded by:
- `web/src/lib/file-capture.test.ts` › "files each posting under its own job, not the first on the board"
- `service/kg/core/capture.test.ts` › "keeps two Indeed jobs opened from one search apart"
- `service/kg/tools/scout.test.ts` › "refuses instead of minting a second draft and moving the edge onto it"

### Q241 — Saving a kept page from the Vault tab must not attach it to an application unless the user tags it.
`fix` · 2026-09-12 · extension · active
Must stay true: Saving a kept page from the Vault tab does not attach it to any application unless the user tags it.
Guarded by:
- `web/src/lib/file-capture.test.ts` › "is filed under NO application, however well the address matches one"

### Q242 — Scout portal shows none while the search-bar approve suggestions shows many; both must come from the same source and be empty after clear.
`fix` · 2026-09-12 · web · active
Must stay true: The Job Scout suggestions and the search-bar approval list read the same suggestion store, so they always agree and both are empty after clearing.
Guarded by:
- `web/src/components/common/tool-form.test.ts` › "lists the suggestions still waiting, and not the answered ones"
- `web/src/components/common/tool-form.test.ts` › "offers nothing at all once the queue has been cleared"
- `service/kg/core/proposal.test.ts` › "is false once the queue is cleared, though the row is still stored"

### Q243 — Pre-filling an application should also use the available keywords.
`feature` · 2026-09-12 · service · active
Must stay true: Prefilling an application from a posting also uses the user's keywords.
Guarded by:
- `service/kg/agent/read-posting.test.ts` › "adds the block and changes nothing else about the prompt"
- `service/kg/agent/read-posting.test.ts` › "hands back what the read found, through both halves together"

### Q287 — In scout approval queue make the link clickable (opens new tab), add a one or two line summary of the posting, and a button on the right to open the link.
`feature` · 2026-10-11 · web · active
Must stay true: Each scout suggestion in the approval queue shows a clickable link that opens in a new tab, a one- or two-line summary of the posting, and an open-link button on the right.
Guarded by:
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "clamps the posting summary to two lines"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "makes the address itself a link that opens in a new tab"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "puts an Open posting button, also a new tab, in the right-hand column"
- `service/kg/core/proposal.test.ts` › "gives the summary, the title and an address that opens"

### Q291 — Approving an application found in job scout does not make it appear in the applications table.
`fix` · 2026-10-16 · web · active
Must stay true: Approving a Job Scout suggestion creates an application that appears in the applications table.
Guarded by:
- `service/kg/react/projections.requests.test.ts` › "is listed by the projection the table reads, as a draft"
- `web/src/components/scout/use-proposal-actions.requests.test.ts` › "promotes what the approval saved into a draft, a posting and a match alike"

### Q292 — Approving a scouted posting adds it to application drafts with the web page captured and stored like an autofilled application, and the page read to fill employer, title, details and tags (not a title like "CRA - Assistant professor manhattan kansas").
`fix` · 2026-10-17 · service · active
Must stay true: Approving a scout suggestion adds an application draft whose posting page is captured and stored with it, and whose employer, title, details and tags are filled from reading the page (ProposalProps.reading, fillDraft), not from the listing title.
Guarded by:
- `web/src/components/scout/use-proposal-actions.requests.test.ts` › "reads the posting into the draft on Approve and on Approve all"
- `web/src/components/scout/use-proposal-actions.requests.test.ts` › "asks the model when one is set up, and only keeps the page when none is"
- `web/src/components/scout/use-proposal-actions.requests.test.ts` › "files the page it read under the draft once the fields are written"
- `service/kg/tools/scout.test.ts` › "files the page under the new application"
- `web/src/lib/fill-from-posting.test.ts` › "writes what the page said over what the address guessed"

### Q294 — Scout only reads the first page of a listing; it must follow pagination (page 2, 3...) on HigherEdJobs, CRA, AcademicCareers and similar boards to find all postings.
`fix` · 2026-10-22 · service · active
Must stay true: The scout follows a board's pagination (Load more, ?Page=N, next links) on HigherEdJobs, CRA, AcademicCareers and similar boards and collects postings from every page (crawlBoard).
Guarded by:
- `service/kg/core/board.test.ts` › "reads every page, once each"
- `service/kg/core/board.test.ts` › "reads HigherEdJobs’ pager: next first, then the numbers, never page one or back"
- `service/kg/core/board.test.ts` › "finds the new jobs behind a first page the person has already seen"
- `web/src/lib/capture-page.test.ts` › "reads the board, and says where, when pressing stayed put"

### Q305 — Scouted job suggestions overshoot the width of the Suggestions container.
`fix` · 2026-10-27 · web · active
Must stay true: Scout suggestion rows stay within the Suggestions container width.
Guarded by:
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "lays the cards out in a one-column grid the panel’s width, not an auto-sized one"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "lets each card shrink below its content, and long words wrap"

### Q306 — When a vLLM/model is available and the user clicks add to application, parse and confirm all filled fields with it.
`feature` · 2026-10-27 · service · active
Must stay true: When a model is available, Add to application has the model parse and confirm all filled fields.
Guarded by:
- `web/src/components/scout/use-posting-actions.requests.test.ts` › "reads the posting into the new draft exactly when a model is configured"
- `web/src/components/scout/use-posting-actions.requests.test.ts` › "makes the draft first, so the read has a record to fill"
- `web/src/lib/fill-from-posting.test.ts` › "reports what the page confirmed, ignoring case"

### Q307 — Scout must not add a posting already in applications or already scouted from another source (HigherEdJobs, CRA, AcademicCareers).
`feature` · 2026-11-05 · service · active
Must stay true: The scout does not add a posting that is already an application or was already scouted from another board (canonicalPostingUrl, knownPostingUrls).
Guarded by:
- `service/kg/agent/pipelines.test.ts` › "is refused when another board’s listing of it was already suggested"
- `service/kg/agent/pipelines.test.ts` › "is refused when it is already an application"
- `service/kg/core/capture.test.ts` › "folds Greenhouse’s two live hostnames and its search tracking"


## Vault, files, backup and transfer

### Q046 — Rename Reminder page to Vault, a collection of tools: reminders, saved URLs, files in category buckets, and other helpful tools.
`change` · 2026-08-08 · web · active
Must stay true: The /vault page holds reminders, links, files, snippets and tools, and /reminders redirects to /vault.
Guarded by:
- `web/src/App.requests.test.ts` › "redirects /reminders to /vault, replacing the history entry"
- `web/src/App.requests.test.ts` › "routes /vault to the Vault page"
- `web/src/App.requests.test.ts` › "lands a redirected bookmark on the reminders tool"
- `web/src/routes/Vault.requests.test.ts` › "offers reminders, links, files, snippets and tools as tabs"
- `web/src/routes/Vault.requests.test.ts` › "renders each tab’s own tool component"

### Q054 — Add user-defined keyword/tag filter (e.g. Developer, Read) across Reminders, Links, Files and Snippets, with tags associable with applications and reminders.
`feature` · 2026-08-08 · web · active
Must stay true: User-defined keywords (KeywordPicker/LabelFilter) filter Reminders, Links, Files and Snippets in the Vault, and a keyword can be attached to applications and reminders.
Guarded by:
- `web/src/routes/Vault.requests.test.ts` › "draws a single LabelFilter scoped to the tab on screen"
- `web/src/routes/Vault.requests.test.ts` › "narrows the %s list by the lit keywords"
- `web/src/routes/Vault.requests.test.ts` › "lets a keyword be attached to an application and to a reminder"
- `web/src/lib/label-selection.test.ts` › "filters on the lit set, never on the raw selection"
- `web/src/components/vault/files/filters.test.ts` › "ANDs unfiled with the keyword row"

### Q055 — Add a Tools tab with a calculator that has history and basic/scientific toggle.
`feature` · 2026-08-08 · web · active
Must stay true: Vault Tools has a calculator (Calculator.tsx over service/kg/core/calculator.ts) with history and a basic/scientific toggle.
Guarded by:
- `web/src/components/vault/calculator-history.requests.test.ts` › "puts the latest calculation on top"
- `web/src/components/vault/calculator-history.requests.test.ts` › "keeps only the most recent, dropping the oldest past the cap"
- `web/src/components/vault/calculator-history.requests.test.ts` › "offers a basic and a scientific mode, and shows the scientific keys only in the second"
- `web/src/components/vault/calculator-history.requests.test.ts` › "has a History toggle that opens a panel listing the entries"
- `web/src/routes/Vault.requests.test.ts` › "offers the calculator and the PDF editor"
- `service/kg/core/calculator.test.ts` › "does the four operations and the power"

### Q057 — Files get a browser-like PDF/document viewer; Snippets get a rich text editor (font size, bold, italic, underline, strike, bullets, table, text colour).
`feature` · 2026-08-08 · web · active
Must stay true: Vault files open in an in-app document viewer (FileViewer/FilePreviewDialog), and snippets use RichTextEditor with font size, bold, italic, underline, strike, bullets, table and text colour.
Guarded by:
- `web/src/components/common/RichTextEditor.requests.test.ts` › "has a font size control wired to the fontSize command"
- `web/src/components/common/RichTextEditor.requests.test.ts` › "has a %s button"
- `web/src/components/common/RichTextEditor.requests.test.ts` › "inserts a table"
- `web/src/components/common/RichTextEditor.requests.test.ts` › "sets the text colour"
- `web/src/components/common/RichTextEditor.requests.test.ts` › "uses the full toolbar, not the inline-only one"
- `web/src/components/common/RichTextEditor.requests.test.ts` › "shows a picked file in the Vault’s own viewer, and the preview dialog reuses it"
- `web/src/components/common/RichTextEditor.requests.test.ts` › "draws a PDF in a frame inside the page rather than handing it off"
- `web/src/components/vault/file-preview.test.ts` › "keeps PDFs and pages on their own paths"

### Q061 — PDF fullscreen preview gets a right notes drawer using the text editor; fullscreen snippet modal has title/keyword options and only one close X (no Close button); drawer collapse icon centred.
`change` · 2026-08-09 · web · active
Must stay true: The full-screen PDF preview has a right notes drawer using the text editor with a centred collapse icon, and the full-screen snippet modal has title/keyword fields and exactly one close X.
Guarded by:
- `web/src/components/vault/FileViewer.requests.test.ts` › "sits beside the document, on its right"
- `web/src/components/vault/FileViewer.requests.test.ts` › "is written in the rich text editor"
- `web/src/components/vault/FileViewer.requests.test.ts` › "collapses to a rail whose icon is centred across it"
- `web/src/components/vault/FileViewer.requests.test.ts` › "renders the same form full screen, title and keywords included"
- `web/src/components/vault/FileViewer.requests.test.ts` › "drops its own Close button full screen"

### Q064 — Add a button in Settings that clears all browser and server storage.
`feature` · 2026-08-09 · web · active
Must stay true: Settings has an action that clears all browser storage (IndexedDB, localStorage) after confirmation.
Guarded by:
- `web/src/lib/storage.requests.test.ts` › "empties local and session storage, every database, the caches and the cookies"
- `web/src/lib/storage.requests.test.ts` › "still clears the rest when one store refuses"
- `web/src/lib/storage.requests.test.ts` › "asks first: the button only stages the clear"
- `web/src/lib/storage.requests.test.ts` › "clears only from the confirmation dialog"
- `web/src/lib/storage.requests.test.ts` › "wipes through clearSiteData, after closing the store"

### Q078 — Use File System Access: first load asks for a folder; IndexedDB holds data and files are mirrored into the folder; re-ask permission after restart.
`feature` · 2026-08-15 · web · superseded
Must stay true: n/a (superseded).
Note: The folder-mirroring File System Access store was replaced by IndexedDB-only file storage (Q095); idb-file-store.ts explains why.; from C1-079

### Q085 — A Vault file can be tagged with a job application, on web and also Android/iOS (mobile had no application tagging).
`feature` · 2026-08-22 · cross · superseded
Must stay true: n/a (superseded).
Note: The one-application-per-file tag was replaced by one-to-many tagging, merged with the open-application view (Q089).; from C2-003

### Q087 — Where-to-save setting with a Select path button that changes a user-defined local folder and actually writes files there.
`feature` · 2026-08-22 · web · superseded
Must stay true: n/a (superseded).
Note: Replaced by IndexedDB file storage (Q095) and the server-code removal (Q096).; from C2-007

### Q089 — Reminders, links, files and snippets can each be tagged to one or many applications, and opening an application shows everything tagged to it.
`feature` · 2026-08-22 · cross · active
Must stay true: A reminder, link, file or snippet can carry several application tags, the tags persist on web and phone, and the application details show every item tagged to it (FiledPanel).
Guarded by:
- `service/kg/core/filed-under.requests.test.ts` › "finds a record by any of its application tags, not just the first"
- `service/kg/react/use-vault.requests.test.ts` › "shows a reminder, a link, a document and a snippet on every application they are filed under"
- `service/kg/react/use-vault.requests.test.ts` › "keeps every tag across a reopen of the store"
- `service/test/filed-under.requests.test.ts` › "selects the vault records filed under a job with filedUnder"
- `service/test/filed-under.requests.test.ts` › "selects the timeline items filed under a job with filedUnder"
- `service/kg/react/projections.test.ts` › "files one record under two applications and shows it on both"

### Q090 — A small native-script companion file server for Linux/Windows/macOS, compiled to binaries by CI, downloadable from the deployed site, secure, offered when the browser lacks the file API.
`feature` · 2026-08-22 · build · superseded
Must stay true: n/a (superseded).
Note: Companion file server dropped: IndexedDB storage (Q095) and remove server code (Q096).; from C2-008

### Q095 — Store application files (CV, cover letter, statements) in IndexedDB via drag and drop, preview later, and allow download of all files.
`change` · 2026-08-22 · web · active
Must stay true: Application files (CV, cover letter, statements) dropped in are stored in IndexedDB (vault-blobs), preview in the app, and can all be downloaded.
Guarded by:
- `web/src/kg/storage/idb-file-store.test.ts` › "survives a reopen, because the whole point is that bytes outlive the tab"
- `web/src/components/vault/files/intake.test.ts` › "files a name the vault has never seen"
- `web/src/components/vault/file-preview.test.ts` › "previews stored text and pictures"
- `web/src/lib/document-archive.test.ts` › "round-trips every document byte for byte, under the names given"

### Q096 — Remove the unnecessary server code and make code audited and compliant with code structure standards.
`change` · 2026-08-22 · build · active
Must stay true: The repo contains no companion file-server code or its CI binaries.
Guarded by:
- `service/test/no-server.requests.test.ts` › "holds no Go source or module anywhere in the repository"
- `service/test/no-server.requests.test.ts` › "builds no server binaries in CI"
- `service/test/no-server.requests.test.ts` › "has no app code dialling the server’s loopback port"

### Q097 — Substantial file change prompts the user to download a local backup; download-and-update re-downloads and replaces the snapshot; nothing deletes all data automatically.
`feature` · 2026-08-22 · web · active
Must stay true: After BACKUP_NUDGE_AT (15) records change since the last backup (demo records nobody touched do not count), the storage banner asks to "Download a backup" (the same backup Settings makes) or "Not now", which keeps it away until the next substantial change; re-downloading replaces the snapshot, and no code path deletes all data automatically.
Guarded by:
- `web/src/lib/backup.test.ts` › "records the backup only after the file exists, on both paths"
- `web/src/lib/backup.test.ts` › "asks once BACKUP_NUDGE_AT records have changed since the last backup, not before"
- `web/src/lib/backup.test.ts` › "stops asking once a backup is taken after the changes"
- `web/src/lib/backup.test.ts` › "does not count demo records nobody has touched"
- `web/src/lib/backup.test.ts` › "stays away after "Not now" until another substantial change, then asks again"
- `web/src/lib/backup.test.ts` › "tells every useBackup when a backup is taken or the prompt is put away"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "is the last arm of the storage banner, below every failure"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "shows only when useBackup says a substantial change has gone unbacked-up"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "downloads the same backup Settings does, and says how it went"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "can be put away until the next substantial change"
- `web/src/lib/backup.test.ts` › "does not ask for a backup of what a restore just brought back"

### Q098 — Importing the backup restores everything including the application graph and all metadata.
`feature` · 2026-08-22 · cross · active
Must stay true: Restoring a backup brings back every record, the application graph, metadata and stored files (backup.ts / service/kg/core/backup-stream.ts).
Guarded by:
- `service/kg/core/backup.test.ts` › "carries the raw rows, not a summary of them"
- `service/kg/core/backup-stream.test.ts` › "is a backup the whole-file reader accepts, holding the same records and bytes"
- `service/kg/repo/restore.test.ts` › "writes the graph and then the documents, and reports both"

### Q099 — Deleted documents must not consume space.
`fix` · 2026-08-22 · web · active
Must stay true: Deleting a document deletes its stored bytes, so it no longer counts toward storage usage (use-file-delete.ts, storage-usage.ts).
Guarded by:
- `web/src/lib/vault-blobs.requests-g4.test.ts` › "leave Documents the moment the document is deleted"
- `web/src/lib/vault-blobs.requests-g4.test.ts` › "are purged on the next page load, before the index is read"
- `web/src/lib/vault-blobs.requests-g4.test.ts` › "go with the record: the delete hook removes them as well"
- `web/src/kg/storage/idb-file-store.test.ts` › "purgeTrash reclaims deleted documents, which trash alone never does"

### Q106 — Change the 'no device' icon to an export icon.
`change` · 2026-08-22 · web · active
Must stay true: The transfer tile with no device paired uses an export icon.
Guarded by:
- `web/src/components/layout/SidebarRuntime.requests-g4.test.ts` › "draws the export icon whatever state the device is in"
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "include the graph and a share tile for Transfer"

### Q107 — Change the text to 'Sync with Other Device'.
`change` · 2026-08-22 · web · active
Must stay true: The transfer tile reads "Sync with Other Device" (SidebarRuntime).
Guarded by:
- `web/src/components/layout/SidebarRuntime.requests-g4.test.ts` › "reads "Sync with Other Device""

### Q112 — Transfer page syncs all storage data across devices and platforms: same-network secure transfer, and a different-network route via camera/animated packets.
`feature` · 2026-08-23 · cross · active
Must stay true: The Transfer page moves all stored data between devices and platforms: same-network secure transfer, with a camera route for the handshake (a QR code since Q329).
Guarded by:
- `service/kg/crypto/end-to-end.test.ts` › "carries a records-sized backup across, byte for byte"
- `service/kg/crypto/end-to-end.test.ts` › "carries a documents-sized backup across"
- `service/kg/crypto/end-to-end.test.ts` › "carries in both directions, on different keys"
- `web/src/components/transfer-ui/groups.test.ts` › "claims every kind of record the seeded graph would actually send"
- `service/kg/core/pairing.test.ts` › "fits in one QR code a phone reads at arm’s length"

### Q114 — Use the animation to hand-shake devices and pass the encryption key; transfer only occurs when both devices share the same wifi/local network.
`feature` · 2026-08-23 · cross · active
Must stay true: Transfer only happens after the camera handshake (a QR code since Q329) has passed the encryption key and both devices are on the same local network (isPrivateAddress).
Guarded by:
- `web/src/lib/handoff-client.requests.test.ts` › "refuses the handshake to %j without touching the network"
- `web/src/lib/handoff-client.requests.test.ts` › "refuses to send a chunk to %j without touching the network"
- `web/src/lib/handoff-send.requests.test.ts` › "sends chunks only after complete() has produced keys"
- `web/src/lib/handoff-send.requests.test.ts` › "stops on a handshake the phone did not answer, before any chunk"
- `service/kg/core/dial.test.ts` › "refuses everything routable"
- `service/kg/core/pairing.test.ts` › "cannot pair by answering with its own key"

### Q120 — Vault lists order newest first (files, reminders, links, snippets).
`change` · 2026-08-23 · web · active
Must stay true: Vault files, links and snippets list newest first. Reminders stay in due-date order: the owner's decision of 2026-11-15.
Guarded by:
- `service/kg/react/projections.test.ts` › "is newest first, so the one just added is at the top"
- `service/kg/react/projections.test.ts` › "is newest first, so the one just saved is at the top"
- `service/kg/react/projections.test.ts` › "is newest first, so the one just written is at the top"
- `service/kg/core/dates.test.ts` › "does not put the newest-added on top, which is the deliberate part"

### Q123 — Category chips with counts distort while editing a snippet.
`fix` · 2026-08-23 · web · active
Must stay true: Category chips with counts keep their shape while a snippet is being edited.
Guarded by:
- `web/src/components/common/BucketFilter.requests.test.ts` › "neither shrinks nor wraps inside itself"
- `web/src/components/common/BucketFilter.requests.test.ts` › "wraps between chips instead"
- `web/src/components/common/BucketFilter.requests.test.ts` › "is the filter the Snippets tab draws its kinds with"

### Q124 — Animated 3D red-dot glow blob carries the data/key; no QR code or dotted square overlay; custom own encoder/decoder.
`change` · 2026-08-23 · cross · superseded
Must stay true: n/a (superseded).
Note: Superseded by Q329 on 2026-11-16: the owner chose a plain QR code after a patent search found active patents on camera-read animated pairing codes. `core/pulse.ts` and `pulse-read.ts` were removed.

### Q125 — Camera reading of the animation only on Android/iOS app; the right-hand QR card is replaced with data transfer information and details.
`change` · 2026-08-23 · web · active
Must stay true: The pairing code is read by camera only on the phone app; the web Transfer page's right-hand column shows transfer information, not a second code (since Q329 the code is the QR on the stage card).
Guarded by:
- `web/src/routes/Transfer.requests.test.ts` › "has the phone read the code out of camera frames"
- `web/src/routes/Transfer.requests.test.ts` › "never opens a camera in the web app"
- `web/src/routes/Transfer.requests.test.ts` › "puts transfer details in the column beside the stage, not a second code"

### Q329 — Pair with a plain QR code instead of the animated pattern, using libraries that are safe in an open-source project.
`change` · 2026-11-16 · cross · active
Must stay true: The computer shows the pairing offer (the 83 bytes of `encodeOffer`) as a standard QR code on the Transfer stage card, drawn with `uqr` (MIT), and the phone reads it from camera frames with `jsqr` (Apache-2.0), accepting only a well-formed jojo offer. Both are pinned to exact versions and credited. The WebGPU scene is decoration and carries nothing.
Guarded by:
- `web/src/routes/Transfer.requests.test.ts` › "draws it with uqr on the computer and reads it with jsqr on the phone, both pinned"
- `web/src/routes/Transfer.requests.test.ts` › "draws the pairing offer as a QR code on the stage card, and the scene carries nothing"
- `mobile/src/lib/pairing-qr.test.ts` › "reads the exact offer back from a code drawn the way the computer draws it"
- `mobile/src/lib/pairing-qr.test.ts` › "reads it off-centre, blurred and noisy, as a hand-held phone sees it"
- `mobile/src/lib/pairing-qr.test.ts` › "ignores a stranger’s QR code"
- `web/src/lib/pairing-qr.test.ts` › "fits an offer into a version-5 code, 37 modules across"

### Q330 — A device records a transfer only once the receiving side has taken the records (fix the remaining transfer findings).
`fix` · 2026-11-16 · cross · active
Must stay true: The sending device stamps its handover only after the receiver's person has applied the transfer. Computer→phone: the computer asks the phone `GET /jojo/<token>/outcome` and stamps on `applied`. Phone→computer: the computer tells the phone with a one-byte `POST /jojo/<token>/outcome`, and the phone stamps on `applied`. A declined, failed or unanswered transfer stamps nothing, and both screens say which it was.
Guarded by:
- `service/kg/core/handoff.test.ts` › "lets the computer ASK a receiving phone, and only with a GET"
- `service/kg/core/handoff.test.ts` › "lets the computer TELL a sending phone, in exactly one byte"
- `web/src/lib/handoff-outcome.test.ts` › "stamps the handover only after the phone says the records were applied"
- `web/src/lib/handoff-outcome.test.ts` › "says the phone holds the records only once it says it took them"
- `mobile/src/lib/handoff-receive.test.ts` › "says pending until the person answers, then what they chose"
- `mobile/src/lib/serve-watch.test.ts` › "reports the answer once when it comes, then closes after the grace"
- `mobile/src/lib/handoff-serve.test.ts` › "hears no outcome before every chunk has gone"

### Q129 — PC-to-mobile also via entering the hashed mobile IP code in the PC browser, which sends a handshake request to the phone; the code only visible on the mobile receive screen; same in reverse from phone.
`feature` · 2026-08-23 · cross · active
Must stay true: Transfer works both ways between a phone and a computer on the same local network: computer→phone by typing the phone's code and sending (core/dial.ts, handoff-send), phone→computer by the computer dialling the phone's code, checking its proof and pulling its sealed backup (core/handoff-pull.ts), then restoring it behind the same confirmation as a backup file. Neither side accepts anything without the pairing proof. The phone half of the pull has not run on a device.
Guarded by:
- `web/src/lib/handoff-send.requests.test.ts` › "shows the code on the phone’s receive screen, built from its own address"
- `web/src/lib/handoff-send.requests.test.ts` › "takes the typed code on the computer and starts the send with it"
- `web/src/lib/handoff-send.requests.test.ts` › "dials the address the code decodes to, and asks that phone for the handshake"
- `service/kg/core/dial.test.ts` › "round-trips the addresses a home network actually hands out"
- `service/kg/core/dial.test.ts` › "catches EVERY single character typed wrong, across many codes"
- `service/kg/crypto/handoff-pull.test.ts` › "pulls the whole backup, byte for byte, from the phone that read its screen"
- `service/kg/crypto/handoff-pull.test.ts` › "serves nothing to a request without a proof, and builds nothing for it"
- `service/kg/crypto/handoff-pull.test.ts` › "refuses a proof made with a different session's key"
- `service/kg/crypto/handoff-pull.test.ts` › "refuses a chunk with one bit changed"
- `web/src/lib/handoff-pull.test.ts` › "dials the typed code, checks the proof, pulls, and hands back a plan"
- `web/src/lib/handoff-pull.test.ts` › "asks for nothing from a device that cannot prove it read this screen"
- `web/src/lib/handoff-pull.test.ts` › "runs the one restore, then stamps the handover and the backup mark"
- `web/src/lib/handoff-pull.requests.test.ts` › "offers "Send to a computer" on the phone"
- `web/src/lib/handoff-pull.requests.test.ts` › "offers "Receive from phone" on the computer, with a real panel behind it"
- `web/src/lib/handoff-pull.requests.test.ts` › "asks the same "replaces / back up first" question, word for word"
- `mobile/src/lib/handoff-serve.test.ts` › "hands its whole backup to the computer that proved itself, which reads it as a backup"
- `mobile/src/lib/instant-day.test.ts` › "says it sends to a computer, never that it only receives or reaches another phone"

### Q162 — Test the untested calculator lines and let the agent use the calculator tool for analytics.
`fix` · 2026-08-24 · service · active
Must stay true: Calculator code is fully tested (calculator.test.ts) and the agent can call the calculator as a tool for analytics.
Guarded by:
- `service/kg/core/calculator.test.ts` › "does the four operations and the power"
- `service/kg/core/calculator.test.ts` › "does the rest of the keys"
- `service/kg/agent/queries.test.ts` › "computes what it is given, and says so both ways"
- `service/kg/agent/queries.test.ts` › "is a read: it touches no records and needs no context"

### Q165 — Unreadable record banner points to Diagnostics which lists nothing; make it findable.
`fix` · 2026-08-24 · web · active
Must stay true: When a record cannot be read, Settings -> Diagnostics lists it and the banner that points there leads to that list.
Guarded by:
- `web/src/components/layout/StorageBanner.requests.test.ts` › "links to the skipped-records row in Settings, not to the page in general"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "names every skipped record, read from the same session the banner counts"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "scrolls to that row and lights it when the banner’s link arrives"
- `web/src/components/layout/StorageBanner.requests.test.ts` › "is on the Settings page"

### Q252 — Increase the expanded preview modal width by 25%.
`change` · 2026-09-13 · web · active
Must stay true: The expanded file-preview dialog is 25% wider than before.
Guarded by:
- `web/src/components/vault/FilePreviewDialog.requests.test.ts` › "is at least a quarter wider than the shared modal at every desktop width"
- `web/src/components/vault/FilePreviewDialog.requests.test.ts` › "does not take the shared content-modal width"

### Q255 — Also widen the initial small preview modal.
`change` · 2026-09-13 · web · active
Must stay true: The initial (small) file-preview dialog is also wider than before.
Guarded by:
- `web/src/components/vault/FilePreviewDialog.requests.test.ts` › "does not take the shared content-modal width"
- `web/src/components/vault/FilePreviewDialog.requests.test.ts` › "is measured against the window, capped so Expand still means something"

### Q261 — Add a PDF Editor in Vault Tools to merge, comment and highlight PDFs.
`feature` · 2026-09-14 · web · active
Must stay true: Vault Tools has a PDF editor (PdfEditor) that merges PDFs and adds comments and highlights.
Guarded by:
- `web/src/lib/pdf/document.test.ts` › "puts every page of every source in, in order"
- `web/src/lib/pdf/document.test.ts` › "writes a highlight a reader will understand"
- `web/src/lib/pdf/document.test.ts` › "writes a comment as a Text annotation, closed"
- `web/src/routes/Vault.requests.test.ts` › "offers the calculator and the PDF editor"

### Q263 — Enable PDF drag and drop on the card.
`feature` · 2026-09-14 · web · active
Must stay true: Dropping a PDF on the PDF editor card loads it (use-dropped-pdfs.ts).
Guarded by:
- `web/src/components/vault/pdf/PdfEditor.requests.test.ts` › "lands on the card itself"
- `web/src/components/vault/pdf/PdfEditor.requests.test.ts` › "reaches whichever panel is showing"
- `web/src/components/vault/pdf/PdfEditor.requests.test.ts` › "is opened by the %s panel"
- `web/src/components/vault/pdf/PdfEditor.requests.test.ts` › "hands the sorted PDFs to the panel, once per delivery"
- `web/src/lib/pdf/dropped-files.test.ts` › "keeps the PDFs in the order they were dropped"

### Q265 — Add a Vault Files filter that shows files not tagged with anything.
`feature` · 2026-09-14 · web · active
Must stay true: The Vault Files filter has an untagged option that shows exactly the files with no tags.
Guarded by:
- `web/src/components/vault/files/filters.test.ts` › "shows only what is filed under nothing when it is on"
- `web/src/components/vault/files/filters.test.ts` › "counts the unfiled ones for the chip"

### Q278 — For each person in the Vault, download an Excel/CSV of the applications where they are a recommender, with posting link, employer, dates, highlight keywords, materials used, plus a per-application notes field.
`feature` · 2026-10-04 · web · active
Must stay true: For each person in the Vault, a download (referee-pack.ts) gives a spreadsheet of the applications where they are a recommender, with posting link, employer, dates, highlight keywords, materials used and a per-application notes column.
Guarded by:
- `web/src/lib/referee-pack.test.ts` › "reads one row per application, with the brief and the materials"
- `service/kg/core/referee-brief.test.ts` › "keeps only applications the person is filed under"
- `web/src/lib/spreadsheet.test.ts` › "writes the parts a workbook needs, content types first"

### Q299 — Downloading a ~500MB backup freezes the browser page; fix.
`fix` · 2026-10-22 · web · active
Must stay true: Downloading a large (about 500 MB) backup streams it (backup-stream.ts) and does not freeze the page.
Guarded by:
- `web/src/lib/backup.test.ts` › "reads a large document in slices rather than whole"
- `web/src/lib/backup.test.ts` › "gathers through streamDocuments rather than in the hook"
- `service/kg/core/backup-stream.test.ts` › "answer for the streamed file, wherever the chunks fall"


## Dashboard, statistics and calendar

### Q004 — Remove the 'local-first job tracker' text; make Follow-ups due auto-flagged and shown as a timeline; add a Recent Applications card; make the dashboard more informative and feature rich.
`change` · 2026-08-07 · web · active
Must stay true: The dashboard renders no "local-first job tracker" text, shows overdue/due follow-ups as a timeline (OwedThisWeek) and has a RecentApplications card.
Guarded by:
- `web/src/routes/Dashboard.requests.test.ts` › "says "local-first job tracker" nowhere in the app"
- `web/src/routes/Dashboard.requests.test.ts` › "has the Owed this week and Recent applications cards"
- `web/src/routes/Dashboard.requests.test.ts` › "flags overdue work by its date and lists it first"

### Q005 — Show Total applications/Active/Interviews/Follow-ups due as a medium widget at the right instead of a full row, and turn the Offer card into a carousel of most important action cards.
`change` · 2026-08-07 · web · active
Must stay true: The headline stats sit in a compact widget beside the priority-actions carousel (PriorityActions), not in a full-width row.
Guarded by:
- `web/src/routes/Dashboard.requests.test.ts` › "puts the stats widget in a narrow column beside the carousel"

### Q006 — Make 'At a glance' four small square cards forming a whole square, reduce their height and width so the carousel is shorter, and add an application statistics row with charts (frequency and category).
`change` · 2026-08-07 · web · active
Must stay true: The dashboard "At a glance" stats render as four small square tiles in one block (GlancePanel), and an application-statistics chart row exists.
Guarded by:
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "are four"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "sit two by two in one block, as figures rather than tall tiles"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "are on the dashboard through the statistics card"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "include frequency and category on the Statistics page"

### Q014 — Make the four stat cards (Applications, Active, Interviews, Follow-ups due) compact and merge a small calendar in a two-row layout.
`change` · 2026-08-07 · web · active
Must stay true: The four glance stats (Applications, Active, Interviews, Follow-ups due) are compact and share a two-row block with a small calendar in GlancePanel.
Guarded by:
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "are four"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "sit two by two in one block, as figures rather than tall tiles"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "share the card with the month, as its second row"

### Q019 — Use a sober soft chart colour palette (first Infogram palette, then a chosen one) instead of the blue and brick combination.
`change` · 2026-08-08 · web · active
Must stay true: Every chart takes its series colours from one shared soft palette, not the old blue-and-brick pair.
Guarded by:
- `web/src/index.requests.test.ts` › "is never bypassed by a colour literal in a chart"
- `web/src/index.requests.test.ts` › "is what the series charts are coloured from"
- `web/src/index.requests.test.ts` › "is declared once per theme, in light and in dark"

### Q020 — Add a card toggle to switch Where they came from between donut chart and progress bars, and Application frequency between bar and line.
`feature` · 2026-08-08 · web · active
Must stay true: ApplicationSources toggles between donut and progress bars and ApplicationFrequency toggles between bars and line, each from a control in the card.
Guarded by:
- `web/src/components/dashboard/ApplicationFrequency.requests.test.ts` › "offers bars and a line"
- `web/src/components/dashboard/ApplicationFrequency.requests.test.ts` › "is a control in the card that sets what is drawn"
- `web/src/components/dashboard/ApplicationSources.requests.test.ts` › "offers bars and a donut"
- `web/src/components/dashboard/ApplicationSources.requests.test.ts` › "is a control in the card that sets the view"
- `web/src/components/dashboard/ApplicationSources.requests.test.ts` › "draws the donut for one option and progress bars for the other"

### Q021 — Add a radar/spider chart on the Statistics page for improvement suggestions.
`feature` · 2026-08-08 · web · active
Must stay true: The Statistics page renders a radar chart (Radar in SearchHealth) with improvement suggestions.
Guarded by:
- `web/src/routes/Statistics.requests.test.ts` › "is mounted on the page"
- `web/src/routes/Statistics.requests.test.ts` › "is drawn from the measured search-health axes"
- `web/src/routes/Statistics.requests.test.ts` › "lists a suggestion for each axis beside it"
- `service/kg/core/statistics.test.ts` › "reports the six axes the panel draws, in order"

### Q022 — Application frequency has a period toggle of weeks, month, quarter; the year option was removed.
`change` · 2026-08-08 · web · active
Must stay true: ApplicationFrequency offers exactly the periods week, month and quarter (PERIOD_NOUN), with no year option.
Guarded by:
- `web/src/components/dashboard/ApplicationFrequency.requests.test.ts` › "are week, month and quarter, with no year"
- `web/src/components/dashboard/ApplicationFrequency.requests.test.ts` › "are the options the period switch offers"

### Q023 — Legend entries on all charts toggle categories on and off.
`feature` · 2026-08-08 · web · active
Must stay true: Clicking a ChartLegend entry hides or shows that series in the chart (useSeriesToggle).
Guarded by:
- `web/src/lib/use-series-toggle.requests.test.ts` › "hides a shown series and shows a hidden one"
- `web/src/lib/use-series-toggle.requests.test.ts` › "touches only the series pressed"
- `web/src/lib/use-series-toggle.requests.test.ts` › "leaves a hidden series out of what is drawn, in the chart order"
- `web/src/lib/use-series-toggle.requests.test.ts` › "ChartLegend hands the pressed key to onToggle"
- `web/src/lib/use-series-toggle.requests.test.ts` › "application frequency draws only the series the legend leaves on"
- `web/src/lib/use-series-toggle.requests.test.ts` › "the donut and the source bars toggle the same slices"
- `web/src/lib/use-series-toggle.requests.test.ts` › "the radar plots only the series its legend leaves on"

### Q034 — Important-jobs carousel cards get a short description and tag capsules.
`change` · 2026-08-08 · web · active
Must stay true: Each priority-actions carousel card shows a short description and tag chips.
Guarded by:
- `web/src/components/dashboard/PriorityActions.requests.test.ts` › "shows a tag chip and a short description under its headline"

### Q035 — Pipeline phases (Draft, Closed, Submitted, Screen) must each have a distinct colour.
`fix` · 2026-08-08 · web · active
Must stay true: Every application stage (Draft, Submitted, Screen, Closed, ...) has its own colour in the pipeline chart; no two stages share one.
Guarded by:
- `web/src/components/dashboard/PipelineBreakdown.requests.test.ts` › "six different colours in the"
- `web/src/components/dashboard/PipelineBreakdown.requests.test.ts` › "give each pie slice its own stage token"

### Q037 — Follow-ups due timeline needs a vertical line through the centre of the circles.
`fix` · 2026-08-08 · web · superseded
Must stay true: The follow-ups timeline draws its vertical line through the centres of the item circles (timeline-visuals.ts).
Note: Superseded: the follow-ups timeline became the grouped "Owed this week" list (2026-08-09), which the owner has worked from since (M130, M135, M505, M508).

### Q038 — Calendar card is split in half; user selects a date to see its planned activity; today and the next date circles must not overlap.
`feature` · 2026-08-08 · web · active
Must stay true: The dashboard calendar card is split in two: picking a date lists that day's planned activity, and the today and next-date markers never overlap.
Guarded by:
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "splits into the month and the selected day when there is room"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "selects a day on click and lists that day"
- `web/src/components/dashboard/GlancePanel.requests.test.ts` › "keeps today and the next day apart"

### Q041 — Pipeline and Recent applications use reduced width, sit in the bottom row to fit the full row/column, with less height.
`change` · 2026-08-08 · web · active
Must stay true: Pipeline and Recent applications sit in the dashboard's bottom row at reduced width and height.
Guarded by:
- `web/src/routes/Dashboard.requests.test.ts` › "stacks Recent applications and Pipeline in the narrower column"

### Q044 — Calendar has previous/next month arrows working both directions, a go-to-month picker between month title and arrows, and a centre dot returning to the current month.
`feature` · 2026-08-08 · web · active
Must stay true: The calendar month header has previous/next arrows that work both ways, a MonthPicker between the title and arrows, and a centre dot that returns to the current month.
Guarded by:
- `web/src/components/calendar/MonthGrid.requests.test.ts` › "puts the month picker between the title and the arrows"
- `web/src/components/calendar/MonthGrid.requests.test.ts` › "steps back with the previous arrow and forward with the next"
- `web/src/components/calendar/MonthGrid.requests.test.ts` › "returns to the current month from the control between the arrows"
- `service/kg/core/calendar.requests.test.ts` › "crosses into the next year going forward"
- `service/kg/core/calendar.requests.test.ts` › "crosses into the previous year going back"
- `service/kg/core/calendar.requests.test.ts` › "comes back to where it started after a step each way"

### Q051 — Calendar: date at top left of every cell regardless of events, today visible (not inverse colour on circle and text), cell height slightly smaller.
`fix` · 2026-08-08 · web · active
Must stay true: Each calendar DayCell shows its date at the top left whether or not it has events, today's date is legible (no inverted circle on the text), and the compact cell height stays (protected design).
Guarded by:
- `web/src/components/calendar/DayCell.requests.test.ts` › "stacks from the top, with the date first and unconditional"
- `web/src/components/calendar/DayCell.requests.test.ts` › "draws today in the accent foreground on the accent circle"
- `web/src/components/calendar/DayCell.requests.test.ts` › "keeps today's digit readable on its circle in the"
- `web/src/components/calendar/DayCell.requests.test.ts` › "keeps the compact cell heights"

### Q052 — Calendar legend (Deadline, Interview, Visit, Call, Prep) toggles event types on/off.
`feature` · 2026-08-08 · web · active
Must stay true: The Calendar page's event-type legend (KIND_LEGEND: every timeline kind, with its icon) toggles each type on and off through the charts' useSeriesToggle/ChartLegend; a hidden type leaves the grid, the day list and the rest-of-month list. The date-colour key stays beside it.
Guarded by:
- `web/src/components/calendar/kind-filter.requests.test.ts` › "lists every event type the calendar has, with its name and icon"
- `web/src/components/calendar/kind-filter.requests.test.ts` › "hides the events of a type switched off and shows them again when switched back on"
- `web/src/components/calendar/kind-filter.requests.test.ts` › "can switch every type off"
- `web/src/components/calendar/kind-filter.requests.test.ts` › "keeps the hidden set in the charts’ toggle hook, filtering the month the grid and day lists read"
- `web/src/components/calendar/kind-filter.requests.test.ts` › "draws the type legend under the grid as chart-legend toggles, beside the date-colour key"
- `web/src/components/calendar/kind-filter.requests.test.ts` › "says a day is hidden rather than empty when every event on it is switched off"
- `web/src/components/calendar/kind-filter.requests.test.ts` › "switches that one type back on so the link lands on its item"

### Q053 — Date font scales up to 75% of cell height.
`change` · 2026-08-08 · web · reverted
Must stay true: n/a (reverted).
Note: Reverted by the owner in M108.; from C1-053

### Q062 — Owed this week card height equals Recent applications plus Pipeline; Vault reminder rows must keep their title on phones.
`fix` · 2026-08-09 · web · active
Must stay true: On the dashboard, Owed this week is as tall as Recent applications plus Pipeline, and Vault reminder rows keep their title visible at phone width.
Guarded by:
- `web/src/routes/Dashboard.requests.test.ts` › "stretches Owed this week to the height of the column beside it"
- `web/src/routes/Dashboard.requests.test.ts` › "wraps its actions under the title below sm"

### Q082 — Dashboard Pipeline card is a coloured pie chart of stages across web, Android and iOS.
`change` · 2026-08-22 · cross · active
Must stay true: The dashboard Pipeline card is a coloured pie of applications per stage (PipelineBreakdown/Pie) on web, Android and iOS.
Guarded by:
- `web/src/components/dashboard/PipelineBreakdown.requests.test.ts` › "draws a pie of applications per stage"
- `mobile/src/theme/tokens.requests.test.ts` › "six different stage colours in the"
- `mobile/src/theme/tokens.requests.test.ts` › "is on the Today screen"
- `mobile/src/theme/tokens.requests.test.ts` › "draws a pie of applications per stage, each slice in its stage colour"

### Q108 — Pipeline card gets a toggle to switch among stats: headline rates, when you applied/application rate, what to work on next.
`feature` · 2026-08-22 · web · active
Must stay true: The dashboard Pipeline card has a toggle that switches between the pipeline, headline rates, when you applied/application rate, and what to work on next.
Guarded by:
- `web/src/components/dashboard/StatsCard.requests.test.ts` › "offers the four views"
- `web/src/components/dashboard/StatsCard.requests.test.ts` › "opens on the pipeline"
- `web/src/components/dashboard/StatsCard.requests.test.ts` › "renders the matching body for each view"
- `web/src/components/dashboard/StatsCard.requests.test.ts` › "is a control on the card that sets the view"

### Q122 — Pipeline card toggle must stay fixed at top right when switching categories; the Bars and lines toggle is right-aligned.
`fix` · 2026-08-23 · web · active
Must stay true: The Pipeline card's view toggle stays at the top right whatever view is shown, and the bars/lines toggle is right-aligned.
Guarded by:
- `web/src/components/dashboard/StatsCard.requests.test.ts` › "shares one unwrapping row with the title, at its right end"
- `web/src/components/dashboard/StatsCard.requests.test.ts` › "keeps its width while the title gives way"
- `web/src/components/dashboard/ApplicationFrequency.requests.test.ts` › "is pushed to the right edge of its row"

### Q186 — Improve the statistical analytics to give the user best recommendations and make analytics fully functional.
`feature` · 2026-08-25 · service · active
Must stay true: The Statistics page and the analytics tool give ranked recommendations from outcome data, with uncertainty (Wilson intervals) and strength stated.
Guarded by:
- `service/kg/core/segments.test.ts` › "matches the published figures"
- `service/kg/core/recommend.test.ts` › "puts everything counted above anything merely suggested"
- `service/kg/agent/queries.test.ts` › "carries the strength of every suggestion"
- `service/kg/agent/queries.test.ts` › "says whether a comparison is a difference or only two numbers"
- `web/src/routes/Statistics.requests.test.ts` › "list the ranked recommendations with each one’s strength"
- `web/src/routes/Statistics.requests.test.ts` › "state each rate with its interval and say whether a difference is real"

### Q190 — Drop 'health'.
`change` · 2026-08-25 · cross · active
Must stay true: The analytics tool result carries no health axes.
Guarded by:
- `service/kg/agent/reads/stats.requests.test.ts` › "has no health key at any depth"
- `service/kg/agent/reads/stats.requests.test.ts` › "does not carry the radar axes under another name"

### Q237 — Long titles in the Later cards overflow the container; fix.
`fix` · 2026-09-12 · web · active
Must stay true: Long titles in the dashboard Later cards truncate or wrap inside their container.
Guarded by:
- `web/src/components/dashboard/OwedThisWeek.requests.test.ts` › "is capped at the width of the strip, down the whole chain"
- `web/src/components/dashboard/OwedThisWeek.requests.test.ts` › "truncates the title and keeps the date whole"

### Q276 — The reminder modal opened from the home page for an application-linked reminder should include a link to go to that application.
`feature` · 2026-10-04 · web · active
Must stay true: A reminder linked to an application shows a link to that application in the reminder modal opened from the dashboard.
Guarded by:
- `web/src/components/timeline/dialog/ItemForm.requests.test.ts` › "is opened on the stored item"
- `web/src/components/timeline/dialog/ItemForm.requests.test.ts` › "offers the applications the record is saved under"
- `web/src/components/timeline/dialog/ItemForm.requests.test.ts` › "draws a link to each of them"

### Q280 — The 'needs a decision' card should also include overdue applications.
`change` · 2026-10-05 · web · active
Must stay true: The dashboard needs-a-decision list includes overdue applications.
Guarded by:
- `service/kg/react/use-priority.test.ts` › "finds an application whose deadline passed — the card the deck never had"
- `web/src/components/dashboard/PriorityActions.requests.test.ts` › "are found by the tested rule"
- `web/src/components/dashboard/PriorityActions.requests.test.ts` › "each become an Overdue card"
- `web/src/components/dashboard/PriorityActions.requests.test.ts` › "reach the dashboard deck"

### Q281 — Make it a carousel with the most recent item at the right-most and all earlier items to its left in chronological order.
`change` · 2026-10-05 · web · active
Must stay true: The needs-a-decision carousel orders items oldest to newest from left to right, with the most recent at the right end.
Guarded by:
- `service/kg/react/use-priority.test.ts` › "lays the deck out along time, the latest last"
- `web/src/components/dashboard/PriorityActions.requests.test.ts` › "is the chronological order, latest last"
- `web/src/components/dashboard/PriorityActions.requests.test.ts` › "opens at the start, so the oldest is on the left"

### Q288 — Clicking a reminder in Owed this week should ask whether to edit it or open the application instead of going straight to edit.
`change` · 2026-10-16 · web · active
Must stay true: Clicking a reminder in Owed this week asks whether to edit it or open its application instead of going straight to edit.
Guarded by:
- `web/src/components/dashboard/OwedThisWeek.requests.test.ts` › "opens through the menu, from the row title and the Later chip"
- `web/src/components/dashboard/OwedThisWeek.requests.test.ts` › "asks edit or open when the item is filed under an application"
- `web/src/components/dashboard/OwedThisWeek.requests.test.ts` › "goes straight to edit only when there is no application to offer"

### Q289 — Add a toggle panel to the Recent applications card with a Sticky Notes board for temporary self-notes, active by default, with an option to add a reminder from it.
`feature` · 2026-10-16 · web · active
Must stay true: The Recent applications card toggles to a Sticky notes board (StickyBoard), shown by default, whose notes persist and can become a reminder (reminderFromNote in sticky.ts).
Guarded by:
- `web/src/components/dashboard/RecentApplications.requests.test.ts` › "toggles between the notes and the recent list"
- `web/src/components/dashboard/RecentApplications.requests.test.ts` › "shows the notes unless this browser last chose the list"
- `web/src/components/dashboard/RecentApplications.requests.test.ts` › "keeps its notes in the store"
- `web/src/components/dashboard/RecentApplications.requests.test.ts` › "turns a note into a reminder through the tested rule"
- `service/kg/core/sticky.test.ts` › "takes the first line as the title and the rest as the detail"
- `service/test/coverage.test.ts` › "writes, edits and removes one, each undoably"

### Q293 — Give the stuck sticky note's background shadow matching rounded corners so it looks natural.
`change` · 2026-10-17 · web · active
Must stay true: A sticky note's shadow has the same rounded corners as the note.
Guarded by:
- `web/src/components/dashboard/StickyBoard.requests.test.ts` › "is on the rounded note itself"
- `web/src/components/dashboard/StickyBoard.requests.test.ts` › "fits inside the padding the board leaves around its notes"
- `web/src/components/dashboard/StickyBoard.requests.test.ts` › "measures each side of a layered shadow"

### Q313 — Dashboard cards with many tasks grow enormously; give them a max height with their own right-edge scrollbar like others.
`fix` · 2026-11-15 · web · active
Must stay true: Dashboard cards with many items have a max height and scroll inside, with their scrollbar on the right edge.
Guarded by:
- `web/src/routes/Dashboard.requests.test.ts` › "caps its height and scrolls with the bar on the card edge"


## Layout, navigation, theme and guide

### Q003 — Make the web page responsive.
`feature` · 2026-08-07 · web · active
Must stay true: The web app lays out at phone, tablet and desktop widths with no horizontal page scroll (the sidebar becomes off-canvas on narrow screens; see sidebar-offcanvas.test.ts).
Guarded by:
- `web/src/components/layout/Sidebar.requests.test.ts` › "is a fixed drawer that slides off to the left until opened"
- `web/src/components/layout/Sidebar.requests.test.ts` › "becomes a permanent column from lg up"
- `web/src/components/layout/Sidebar.requests.test.ts` › "is opened from a menu button that only exists below lg"
- `web/src/components/layout/sidebar-offcanvas.test.ts` › "is taken out of reach as a whole, not control by control"

### Q007 — Add Calendar, Statistics and Reminder pages, and mock pages for Applications, Job scout, My profile, Assistant, Settings and How to use.
`feature` · 2026-08-07 · web · active
Must stay true: App.tsx defines routes for the dashboard, applications, calendar, statistics, vault, scout, profile, assistant, settings and guide.
Guarded by:
- `web/src/App.requests-g6.test.ts` › "routes the dashboard as the index page"
- `web/src/App.requests-g6.test.ts` › "routes /%s to %s"

### Q008 — Add a small tagline 'Your Jarvis for Job Organization' beside the icon, below the jojo name text, not below the icon; the search bar must not scroll.
`change` · 2026-08-07 · web · active
Must stay true: The brand card shows the tagline "Jarvis for Job Organization" under the jojo name (BrandCard.tsx), and the sidebar search does not scroll away with the page.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "shows the tagline under the jojo name (Q008)"
- `web/src/components/layout/Topbar.requests.test.ts` › "lives in a bar pinned to the top, so it does not scroll away"

### Q009 — Remove the text 'jojo - everything runs on your machine.'
`change` · 2026-08-07 · web · active
Must stay true: The text "jojo - everything runs on your machine." is not rendered anywhere.
Guarded by:
- `web/src/App.requests-g6.test.ts` › "never says "jojo - everything runs on your machine." (Q009)"

### Q010 — Make the colour theme and charts more professional and raise the UI to Apple/Google/Microsoft UX standard, with a plan and fixes.
`change` · 2026-08-07 · web · superseded
Must stay true: n/a (superseded).
Note: Vague polish ask; the theme was replaced by the shadcn theme request (see Q017).; from C1-011

### Q011 — Use an animated app icon (four stage icons glowing in sequence) that is clearly visible in both light and dark themes, including the inner four icons.
`feature` · 2026-08-07 · web · superseded
Must stay true: n/a (superseded).
Note: Animated logo icon replaced by the mascot card and then the Spline robot (Q012, Q015) — itself since replaced by jojo's own R3F robot.; from C1-012

### Q012 — Put the logo in a separate square card above the sidebar menu with a futuristic 3D animated background (molecule-style animation as hero-futuristic or Spline robot).
`change` · 2026-08-07 · web · superseded
Must stay true: n/a (superseded).
Note: The animated background was replaced by the Spline robot (Q015) — itself since replaced by jojo's own R3F robot.; from C1-013

### Q013 — Navbar shows separate icon buttons (not a dropdown) after the Academia/Industry toggle in the order: Profile, Settings, Chat | AI assistant | Theme | How to use; the AI assistant uses the react-icons RiRobot3Fill robot icon.
`change` · 2026-08-07 · web · active
Must stay true: Topbar.tsx shows separate icon buttons (no dropdown) after the role filter in the order My profile, Settings | Assistant (RobotIcon) | How to use, with dividers between groups.
Guarded by:
- `web/src/components/layout/Topbar.requests.test.ts` › "are separate links, not a dropdown"
- `web/src/components/layout/Topbar.requests.test.ts` › "run My profile, Settings | Assistant | How to use"
- `web/src/components/layout/Topbar.requests.test.ts` › "draw the assistant as the robot icon"

### Q015 — Remove the logo and animation in the square and show the Spline robot from 21st.dev exactly, looking at the cursor.
`change` · 2026-08-07 · web · active
Must stay true: The sidebar mascot card renders a 3D robot (JojoRobot.tsx), not a logo animation, looking at the cursor.
Note: Delivered as the Spline robot from 21st.dev (SplineRobot.tsx); since replaced by a CC BY 4.0 model ("Sci-fi O.B. Robot Unit TH-ICC02" by Jungle Jim, credited in THIRD-PARTY-NOTICES.md and on the Built with page), prepared by web/scripts/robot/prepare_model.py and drawn with React Three Fiber (JojoRobot.tsx, RobotScene.tsx) — so no third-party runtime, scene or wasm ships.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "renders the 3D robot, not a logo (Q015)"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "renders the 3D robot, a licensed model served from this app (Q015, Q149)"

### Q016 — The robot must follow the cursor anywhere on the entire page, not only inside its box.
`fix` · 2026-08-08 · web · active
Must stay true: The robot's head and body follow the cursor anywhere on the page, not only while the pointer is inside its card.
Guarded by:
- `web/src/components/brand/JojoRobot.requests.test.ts` › "follows the cursor across the whole page, not just its card (Q016)"
- `web/src/lib/robot-rig.test.ts` › "turns toward the pointer, the head further than the body"

### Q017 — Replace the colour theme (light and bluish dark) with the ui.shadcn.com light and dark themes for the web app.
`change` · 2026-08-08 · web · active
Must stay true: Light and dark theme tokens in index.css follow the shadcn/ui light and dark palettes.
Guarded by:
- `web/src/index.requests-g6.test.ts` › "maps the shadcn contract onto the app tokens"
- `web/src/index.requests-g6.test.ts` › "uses the neutral palette: greys with no hue, and a monochrome primary"
- `web/src/index.requests-g6.test.ts` › "takes shadcn neutral’s foreground and primary in both themes"

### Q018 — Update soft colours of progress bars, charts and similar elements to suit the new light/dark theme.
`change` · 2026-08-08 · web · active
Must stay true: Progress bars and chart fills take their colours from theme tokens in index.css, so they read well in both themes.
Guarded by:
- `web/src/index.requests-g6.test.ts` › "declares every series and stage colour for each theme separately"
- `web/src/index.requests-g6.test.ts` › "hands the charts those tokens"
- `web/src/index.requests-g6.test.ts` › "leaves no fixed colour in the charts, the statistics or the dashboard bars"

### Q024 — Replace the Academia/Industry filter with user-set role tags (Assistant Professor, Researcher, Developer, PostDoc...) that the user multi-selects, updating charts; use a modern UX, not necessarily a dropdown.
`change` · 2026-08-08 · web · active
Must stay true: The role filter (RoleFilter) sits in the top bar again, the owner's decision of 2026-11-15: one multi-select selection of the user's own role tags (roles-context), no Academia/Industry toggle, everything shown when nothing is selected; every Dashboard and Statistics chart counts through useScopedApplications/scopeByRoles, and the Applications list reads the same selection.
Guarded by:
- `web/src/lib/roles-context.requests.test.ts` › "adds a second tag beside the first rather than replacing it"
- `web/src/lib/roles-context.requests.test.ts` › "takes a tag off when it is picked again"
- `web/src/lib/roles-context.requests.test.ts` › "shows records with any selected tag, and everything when none is selected"
- `web/src/lib/roles-context.requests.test.ts` › "offers the user’s own role vocabulary, with no Academia/Industry choice"
- `web/src/components/layout/Topbar.requests.test.ts` › "has no Academia/Industry switch"
- `web/src/components/layout/Topbar.requests.test.ts` › "sits in the top bar, beside New"
- `web/src/lib/roles-context.requests.test.ts` › "counts every record, as the very same lists, when no role is selected"
- `web/src/lib/roles-context.requests.test.ts` › "counts only the records under the selected roles, stage and source alike"
- `web/src/lib/roles-scope.requests.test.ts` › "%s counts the records the role filter lets through"
- `web/src/lib/roles-scope.requests.test.ts` › "narrow by the shared top-bar selection, through scopeByRoles"
- `web/src/lib/roles-scope.requests.test.ts` › "reads the one shared selection and no longer shows a filter of its own"

### Q025 — Search bar opens a Mac Spotlight style centered overlay with filtered results below; make the overlay wider.
`feature` · 2026-08-08 · web · active
Must stay true: Search opens a centred, wide Spotlight-style overlay (SpotlightSearch) with filtered results listed below the input.
Guarded by:
- `web/src/components/layout/SpotlightSearch.requests.test.ts` › "is a dialog over the page, opened from the topbar"
- `web/src/components/layout/SpotlightSearch.requests.test.ts` › "is wide: up to 44rem, and nearly the whole screen on a phone"
- `web/src/components/layout/SpotlightSearch.requests.test.ts` › "sits high and centred, the way Spotlight does"
- `web/src/components/layout/SpotlightSearch.requests.test.ts` › "lists the filtered results below the input"

### Q026 — Use the robot icon as favicon.
`change` · 2026-08-08 · web · active
Must stay true: index.html declares a robot favicon whose file exists under web/public.
Guarded by:
- `web/src/index.requests-g6.test.ts` › "is declared by index.html and served from public/"
- `web/src/index.requests-g6.test.ts` › "is the robot: the jojo mark with its visor and eyes"

### Q027 — Move the theme toggle to the top right of the robot jojo box.
`change` · 2026-08-08 · web · active
Must stay true: The theme toggle sits at the top right of the mascot card (BrandCard.tsx), not in the topbar.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "puts the theme toggle in the top-right corner of the card (Q027)"
- `web/src/components/brand/BrandCard.requests.test.ts` › "keeps the theme toggle out of the topbar (Q027)"

### Q028 — Page content should fade out before scrolling under the navbar, without fading the navbar or the top of the robot box.
`fix` · 2026-08-08 · web · active
Must stay true: Page content fades out as it scrolls under the topbar, and the fade never covers the topbar or the top of the mascot card.
Guarded by:
- `web/src/components/layout/AppShell.requests.test.ts` › "fades into a scrim that is solid page colour at the top and clear below"
- `web/src/components/layout/AppShell.requests.test.ts` › "never covers the topbar or the mascot card"
- `web/src/components/layout/AppShell.requests.test.ts` › "leaves the page column without a z-index, so the bars are not trapped beneath it"

### Q029 — Play a switch click sound when the user toggles the theme.
`feature` · 2026-08-08 · web · active
Must stay true: Toggling the theme plays a switch click (playSwitchClick from lib/sound) in step with the state change.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "plays the switch click in the same handler that flips the theme (Q029)"

### Q030 — Invert robot animation colours for light theme.
`change` · 2026-08-08 · web · reverted
Must stay true: n/a (reverted).
Note: Owner rewound the colour inversion in M071.; from C1-030

### Q031 — Keep the earlier 3D robot and add own animation gestures.
`feature` · 2026-08-08 · web · active
Must stay true: The 3D robot is kept and has its own scripted gestures (robot-rig.ts).
Note: First built as gestures layered on the Spline scene (spline-rig.ts); since replaced by a rigged CC BY model (JojoRobot.tsx, RobotScene.tsx, robot-rig.ts) whose bundled animation is removed, so every gesture is jojo's own, driven through its skeleton.
Guarded by:
- `web/src/components/brand/JojoRobot.requests.test.ts` › "drives its own scripted gestures through the rig (Q031)"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "blends an interrupted gesture instead of snapping (Q031)"
- `web/src/lib/robot-rig.test.ts` › "leaves nothing running once a gesture has landed"

### Q032 — On page load the previous 2D robot flashes briefly; fix it.
`fix` · 2026-08-08 · web · active
Must stay true: On page load no 2D fallback robot appears before the 3D robot.
Guarded by:
- `web/src/components/brand/JojoRobot.requests.test.ts` › "does not show the 2D robot while the 3D one is still loading (Q032)"

### Q033 — Robot has selectable gestures: keep Nod, Shake, Startle and a body-only Dance, drop Hello/Thumbs up/Head scratch/Thinking/Excited, add new gestures from existing body movement, chosen via a single temporary dropdown.
`feature` · 2026-08-08 · web · active
Must stay true: The mascot gesture set keeps Nod, Shake, Startle and Dance, and every gesture moves the body or head; Thumbs up, Head scratch, Thinking and Excited do not exist.
Note: Revised by the owner 2026-11-15, with a rigged model: the arms may move in the Dance and in new moves (Shrug, Look around, Hop spin, Stretch were added, then Flex, Punch combo, Power up, Doze off, Wink, Love and Robot dance under Q316, and seven hand gestures under Q319); the "body-only" rule is lifted. Hello came back as Hi, a right-hand wave, at the owner's request (Q326); the other four dropped gestures stay dropped.
Guarded by:
- `web/src/lib/mascot-context.requests.test.ts` › "keeps Nod, Shake, Startle and Dance"
- `web/src/lib/mascot-context.requests.test.ts` › "has none of the five that were dropped"
- `web/src/lib/mascot-context.requests.test.ts` › "dances with its arms as well as its body (Q033, revised)"
- `web/src/lib/mascot-context.requests.test.ts` › "moves the body or head in every gesture, so none is an arm alone"

### Q314 — Add a light round button at the top left of the mascot card listing the gestures, ending with the model's attribution.
`feature` · 2026-11-15 · web · active
Must stay true: The brand card's top-left corner has a round light-on-dark button, styled like the theme toggle, that opens beside the card a list of every move (each playable, with its stroke) ending with the robot model's CC BY credit.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "puts a moves button in the top-left corner that lists every move and ends with the robot credit (Q314)"
- `web/src/components/brand/BrandCard.requests.test.ts` › "opens the moves beside the card, not over the robot (Q314)"
- `web/src/components/brand/MascotMoves.requests.test.ts` › "credits the robot model as its CC BY licence asks: title, artist, source, licence, changes (Q314)"

### Q315 — Make the mascot card a mouse gesture pad for different actions, and list the strokes.
`feature` · 2026-11-15 · web · active
Must stay true: A stroke drawn on the brand card (tap, double tap, press and hold, swipes, a flick, back and forth, zigzag, scribble, circle, square, V, peak, Z) plays the move it names, anything unreadable plays Wobble, the keyboard can still poke the robot, and every stroke is listed beside its move.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "reads strokes drawn on the card and plays the move each names (Q315)"
- `web/src/components/brand/BrandCard.requests.test.ts` › "still lets the keyboard poke the robot (Q315)"
- `web/src/lib/gesture-pad.test.ts` › "reads straight swipes by direction"
- `web/src/lib/gesture-pad.test.ts` › "reads a loop either way round, and tells a square from a circle"
- `web/src/lib/gesture-pad.test.ts` › "answers a scrawl it cannot read rather than ignoring it"
- `web/src/lib/gesture-pad.test.ts` › "plays a move the mascot knows for every stroke, and lists each stroke once"

### Q316 — Add more cool actions to the mascot.
`feature` · 2026-11-15 · web · active
Must stay true: The mascot also has Flex, Punch combo, Power up, Doze off, Wink, Love (heart eyes) and Robot dance, each reachable by a stroke, each moving the body or head (Q033).
Guarded by:
- `web/src/lib/gesture-pad.test.ts` › "has Flex, Punch combo, Power up, Doze off, Wink, Love and Robot dance, each on a stroke"
- `web/src/lib/robot-rig.test.ts` › "keeps the eyes on the visor: every expression within its range"
- `web/src/lib/mascot-context.requests.test.ts` › "moves the body or head in every gesture, so none is an arm alone"

### Q317 — The mascot's eyes sit too low, at the nose area; raise them a little.
`fix` · 2026-11-15 · web · active
Must stay true: The drawn eyes sit at the middle of the visor, not on its lower slope.
Guarded by:
- `web/src/components/brand/JojoRobot.requests.test.ts` › "hangs the eyes at the middle of the visor, not on its slope toward the chin (Q317)"

### Q318 — Reflect the new moves, the gesture pad and the attribution on the Settings page too.
`feature` · 2026-11-15 · web · active
Must stay true: Settings › Appearance offers every move as a button, lists every stroke with its move, and shows the robot model's credit.
Guarded by:
- `web/src/components/brand/MascotMoves.requests.test.ts` › "shows the moves, the strokes and the credit in Settings too (Q318)"

### Q319 — Add some more hand gestures to the mascot.
`feature` · 2026-11-15 · web · active
Must stay true: The mascot also has Jazz hands, Point, Hero pose, Hands up, Disco, Typing and Drumroll; Jazz hands, Point and Disco each have a stroke (an arc, an L, a triangle).
Guarded by:
- `web/src/lib/gesture-pad.test.ts` › "has Jazz hands, Point, Hero pose, Hands up, Disco, Typing and Drumroll"
- `web/src/lib/gesture-pad.test.ts` › "reads an arc, an L and a triangle"
- `web/src/lib/gesture-pad.test.ts` › "still tells the earlier strokes apart from the new ones"

### Q320 — Change the moves button's icon from the AI (sparkle) icon to a robot icon.
`change` · 2026-11-15 · web · active
Must stay true: The brand card's moves button shows a robot icon, not a sparkle.
Guarded by:
- `web/src/components/brand/BrandCard.requests.test.ts` › "shows a robot, not a sparkle (Q320)"

### Q321 — Hand gestures over the chest overlap and vanish into the chest; fix that.
`fix` · 2026-11-15 · web · active
Must stay true: No gesture folds a forearm across the chest, where the hand sinks into the armour; hands go beside the head, the shoulders or the hips.
Note: The model's chest and shoulders are too broad for hands to meet in front of it, and the card frames the head too closely for hands above it; Clap, Arms crossed and Rub hands became Jazz hands, Hands up and Drumroll, and Love raises its hands beside the shoulders.
Guarded by:
- `web/src/lib/robot-rig.test.ts` › "never folds a forearm across the chest, where the hand sinks into the armour (Q321)"

### Q322 — The head's pointer tracking is not as fast and pointed as the old Spline robot's; make it so.
`fix` · 2026-11-15 · web · active
Must stay true: The head aims at the pointer (a true aim near the robot: a pointer 100px off turns it about 18°) and closes most of a turn within 0.15s, while the body's share stays under 15°.
Guarded by:
- `web/src/lib/robot-rig.test.ts` › "points at the pointer, turning hard for one close by, as the old robot did"
- `web/src/lib/robot-rig.test.ts` › "catches up with the pointer quickly, the head faster than the body"
- `web/src/lib/robot-rig.test.ts` › "never swings past its limits, however far the pointer goes"

### Q323 — Tag fitting mascot gestures to user actions in the app (e.g. a draft moved to submitted dances).
`feature` · 2026-11-15 · web · active
Must stay true: Stage moves play their stage's gesture everywhere a stage changes (draft→submitted dances, screen bounces, interview powers up, offer hop-spins; Closed loves an acceptance, nods at a withdrawal or a declined offer, and plays nothing over a rejection or a ghosting), and new applications, duplicates, finished tasks, saved backups, scout runs and assistant questions each play theirs, from the one table in lib/mascot-cues.ts.
Guarded by:
- `web/src/lib/mascot-cues.test.ts` › "dances when a draft is sent off, the owner's own example"
- `web/src/lib/mascot-cues.test.ts` › "closes by the outcome: love for an acceptance, a nod for your own call, nothing over bad news"
- `web/src/lib/mascot-cues.test.ts` › "plays the stage gesture wherever a stage changes: the board, the table and the detail page"
- `web/src/lib/mascot-cues.test.ts` › "bounces for a new application, by hand or from the scout"
- `web/src/lib/mascot-cues.test.ts` › "nods when a task is ticked off, and not when one is reopened"
- `web/src/lib/mascot-cues.test.ts` › "flexes for a saved backup, scans for a scout run, types while the assistant works"

### Q324 — Replace the tour's basic modal with a hands-on tutorial: visuals and highlights on the real app, like modern websites.
`change` · 2026-11-15 · web · active
Must stay true: The tour walks the real pages with a spotlight on each element and a card beside it; hands-on steps wait for the reader to do the thing (draw on jojo, open a page, switch the view, open the New menu or the palette) and move on by themselves; Next always works; and the tour itself never types, saves or changes anything.
Note: Replaces the seven-step dialog on the guide page, whose header had rejected coach marks only for want of a mount point above the router — the app shell is in this package, so the tour lives there (components/tour).
Guarded by:
- `web/src/components/tour/tour.requests.test.ts` › "only ever ask the reader for things that write nothing"
- `web/src/components/tour/tour.requests.test.ts` › "point only at elements the app really marks"
- `web/src/components/tour/tour.requests.test.ts` › "is done when a menu opens, and again when it closes"
- `web/src/components/tour/tour.requests.test.ts` › "passes over a step about a menu that is not open, and only such a step"
- `web/src/components/tour/tour.requests.test.ts` › "lives in the app shell, inside the router, so it can walk from page to page"
- `web/src/components/tour/tour.requests.test.ts` › "starts where the reader is, from onboarding and from the guide"

### Q325 — Add tour steps for every end-to-end aspect: connecting vLLM, OpenAI or Claude by API or endpoint, starting and testing the MarkItDown server, file preview, chat, job scout, statistics, PDF merge tools, the knowledge graph, browser storage, and adding or editing tags.
`feature` · 2026-11-15 · web · active
Must stay true: The guided tour covers the model connection (local servers by address; OpenAI, Anthropic (Claude) and others by API key), the document reader's setup and Test, file preview, the chat, scout pipelines, statistics, the PDF editor, the knowledge graph, browser storage, and keywords (picking, adding, renaming, recolouring), with hands-on steps where they write nothing.
Guarded by:
- `web/src/components/tour/tour.requests.test.ts` › "covers every area: models, the reader, files, chat, scout, statistics, PDF tools, the graph, storage and keywords"
- `web/src/components/tour/tour.requests.test.ts` › "names the model providers the app really offers"
- `web/src/components/tour/tour.requests.test.ts` › "is done when a keyword is picked in the filter row"
- `web/src/components/tour/tour.requests.test.ts` › "is done on a vault tab only when that tab is the one open"

### Q326 — Add a jojo mascot right-hand "Hi" gesture, and make it the first one when the page first loads.
`feature` · 2026-11-15 · web · active
Must stay true: The mascot has a Hi gesture — its right hand raised beside its head, open and flat (fingers and thumb straightened, palm turned out), waving — and it is the greeting the robot plays once it has risen into place on a first load (in rendered time, once per scene); a refresh keeps the bow (owner, 2026-11-16).
Note: Revises Q033, which had dropped a Hello gesture; the owner asked for this one.
Guarded by:
- `web/src/components/brand/JojoRobot.requests.test.ts` › "lets the robot finish rising into place before the greeting (Q083)"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "greets once per scene, so the arrival does not shake (Q083)"
- `web/src/lib/mascot-context.requests.test.ts` › "moves the body or head in every gesture, so none is an arm alone"
- `web/src/lib/mascot-context.requests.test.ts` › "waves Hi with an open, flat palm — the fingers and thumb straightened — not a fist (Q326)"
- `web/src/lib/mascot-cues.test.ts` › "waves hi on a first load, and bows on a refresh"

### Q327 — Fix the mobile guided tour and bring it to parity with the web tour where the platform allows.
`change` · 2026-11-16 · mobile · active
Must stay true: The phone's tour is a coach-mark overlay drawn beside the navigator: it opens each screen itself, lights the real control (a tab, a header button, a More row, a Settings card) with the cut-out ring in jojo's orange, and its hands-on steps move on once the reader does the thing (open a tab or screen, switch to Board, pick Files); Next and Skip always work, Android's back button ends it keeping the place, and it never writes. It says what the phone does where it differs from the browser (no PDF editor; only PDFs need the reader).
Note: Replaces the six-step sheet, whose header rejected an overlay for want of a way to find controls; `TourTarget` marks them and the overlay measures them against its own root. Returning to a tab uses `StackActions.popTo('Tabs')`, since React Navigation 7's `navigate` stacked a second copy of the tabs from How to use.
Guarded by:
- `mobile/src/lib/tour.requests.test.ts` › "only ever ask the reader for things that write nothing"
- `mobile/src/lib/tour.requests.test.ts` › "point only at controls the app really marks"
- `mobile/src/lib/tour.requests.test.ts` › "covers the whole app, end to end"
- `mobile/src/lib/tour.requests.test.ts` › "says what the phone does where it differs from the browser"
- `mobile/src/lib/tour.requests.test.ts` › "draws the tour beside the navigator, where it outlives every screen"
- `mobile/src/lib/tour.requests.test.ts` › "reaches the navigator only through its ref, never the hook that throws out there"
- `mobile/src/lib/tour.requests.test.ts` › "lets Android’s back button leave the tour, keeping the place"

### Q328 — Thoroughly review the full codebase to find any missing or broken part, then fix it end to end.
`fix` · 2026-11-16 · cross · active
Must stay true: The defects the 2026-11-16 review found and reproduced stay fixed: pay ranges and "pcm" keep their period; dotted memory.list fields come back; record queries read an instant in the local day; Statistics counts custom role tags; a punctuation-only checklist step is refused; a timeout names the real wait; note colours stay apart; calendar links carry a whole date and the today marker moves at midnight; Duplicate and Delete keep the list's filters; a crash is recorded once; the tour neither bounces on Back nor swallows a menu's keys; phone sheets hold and scroll their content; the phone keeps notes, deadlines and event undos honest, follows links into an open tab, asks before discarding a snippet, reads a CV in one undoable write, sends the web's usage events, and the profile's sector switches reach the scout.
Note: Run as six area reviews (service, web lib/routes, web components, mobile screens/sheets, end-to-end seams; the mobile lib review was refused by the permission system and done by hand). Each finding was reproduced before it was fixed. Transfer, backup and i18n files belong to the parallel session and were reported to it, not edited. Left to the owner, and answered yes in Q331: whether the phone should show the web's sticky notes and hand-edited stage dates.
Guarded by:
- `service/kg/core/comp.test.ts` › "reads the period after the top of the range as the whole range's"
- `service/kg/core/comp.test.ts` › "does not take a period word for a currency code"
- `service/kg/core/statistics.test.ts` › "counts applications under a custom role tag, so the rows still cross-foot"
- `service/kg/agent/record-query.test.ts` › "matches "today" by the day the person is in, not the UTC date"
- `service/kg/agent/record-query.test.ts` › "returns a dotted field it accepted, rather than silently dropping it"
- `service/kg/tools/checklist.test.ts` › "refuses a step that is only punctuation, rather than reporting one added"
- `service/kg/core/model-server.test.ts` › "names the wait the request was given, not always the default"
- `service/kg/core/profile.test.ts` › "keeps a round to the one kind that is switched on"
- `web/src/lib/note-html.test.ts` › "keeps each word in its own colour"
- `web/src/lib/today.test.ts` › "writes a date as all of year, month and day, so a link means the same day later"
- `web/src/components/tour/tour.requests.test.ts` › "moves on by itself only for a task done while its step was showing"
- `web/src/components/tour/tour.requests.test.ts` › "leaves a key alone that a menu or a radio group already handled"
- `mobile/src/lib/review-fixes.requests.test.ts` › "measure their 92% cap against the screen, not against their own content"
- `mobile/src/lib/review-fixes.requests.test.ts` › "takes back every field an event edit wrote, including ones it added"
- `mobile/src/lib/review-fixes.requests.test.ts` › "apply a stage or a sort to Applications, then clear them"
- `mobile/src/lib/review-fixes.requests.test.ts` › "sends each feature event the web sends, so opted-in phone usage is not just opens"
- `mobile/src/lib/review-fixes.requests.test.ts` › "reads a CV into the profile in one undoable write, as the web does"
- `mobile/src/lib/review-fixes.requests.test.ts` › "appends the sector rule to every scout round's instructions"

### Q036 — All scrollbars use a glassmorphic style.
`change` · 2026-08-08 · web · active
Must stay true: Scrollbars across the app use the glassmorphic style defined globally in index.css (protected design).
Guarded by:
- `web/src/index.requests-g6.test.ts` › "paints a translucent, tinted thumb with a sheen and a rim over a clear track"
- `web/src/index.requests-g6.test.ts` › "declares the glass tokens for both themes, translucent in each"
- `web/src/index.requests-g6.test.ts` › "gives Firefox the same thumb, only where the webkit rules do not apply"

### Q042 — Runtime info (Browser storage, Localhost bridge, vLLM) shrinks to one row of icons with values below, as three clickable (mock) buttons.
`change` · 2026-08-08 · web · superseded
Must stay true: n/a (superseded).
Note: The three-button runtime row became the 2x2 runtime grid with Graph and Share (Q060); the Localhost bridge tile is gone.; from C1-042

### Q048 — In every card the vertical scrollbar sits at the card's right edge and the horizontal one at its bottom edge (Owed this week, kanban phases, the reminder carousel).
`fix` · 2026-08-08 · web · active
Must stay true: Every scrollable card (Owed this week, the reminder carousel, kanban columns, other cards) puts its vertical scrollbar flush on the right edge and its horizontal scrollbar flush on the bottom edge, with no padding between scrollbar and edge.
Guarded by:
- `web/src/components/common/Panel.requests.test.ts` › "PanelScroll cancels exactly the panel’s padding, sides and bottom"
- `web/src/components/common/Panel.requests.test.ts` › "Owed this week puts its bar on the card’s right and bottom edges"
- `web/src/components/common/Panel.requests.test.ts` › "the reminder carousel puts its bar on the card’s bottom edge"

### Q050 — Every page except Dashboard has a circular settings button left of the page name that edits that page's functionality, including Graph and Transfer.
`feature` · 2026-08-08 · web · active
Must stay true: Every page except the dashboard that has page settings (including Graph and Transfer) shows a round settings button left of its title in PageHeader.
Guarded by:
- `web/src/components/common/PageHeader.requests.test.ts` › "is round, and drawn before the title"
- `web/src/components/common/PageHeader.requests.test.ts` › "is on the %s page"
- `web/src/components/common/PageHeader.requests.test.ts` › "is not on the dashboard"

### Q056 — Remove the 'works offline' and 'Has keyboard support' texts.
`change` · 2026-08-08 · web · active
Must stay true: The strings "works offline" and "Has keyboard support" are not shown in the UI.
Guarded by:
- `web/src/App.requests-g6.test.ts` › "never says "works offline" or "Has keyboard support" (Q056)"

### Q058 — Complete the interactive mock with all user journeys (add application form, add reminder, etc.) and fix audit findings.
`feature` · 2026-08-08 · web · process
Must stay true: n/a (process).
Note: Mock-era journey completion and audit; the HTML mock is deleted and the journeys are covered by specific items.; from C1-058

### Q060 — Runtime sidebar section has four icon buttons in a 2x2 grid including Graph and Share; transfer page drops demonstration texts and the What moves card, adds a Transfer files toggle default disabled.
`change` · 2026-08-09 · web · active
Must stay true: SidebarRuntime renders its tiles as a 2x2 icon grid including Graph and Share; the Transfer page has no demo texts or "What moves" card, and its Transfer files toggle defaults to off.
Guarded by:
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "include the graph and a share tile for Transfer"
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "are laid out as a two-column grid of icon tiles"
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "sends files only when asked — the switch starts off"
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "has no "What moves" card and no demonstration copy"

### Q073 — On first load show a data reset modal that deletes mock data to start from scratch; Settings has a Load mock data button.
`feature` · 2026-08-10 · web · active
Must stay true: On first load a first-run choice (FirstRunChoice) lets the user start empty (deleting demo data), and Settings -> Data offers loading demo data again (data-set.ts).
Guarded by:
- `web/src/lib/data-set.test.ts` › "leaves NOTHING in the database when the choice is empty"
- `web/src/lib/data-set.test.ts` › "loads the demo data back into an emptied store"
- `web/src/routes/Settings.requests.test.ts` › "offers Start empty on first run"
- `web/src/routes/Settings.requests.test.ts` › "offers the demo data again from Settings → Data"

### Q075 — How to use gets separate pages for user guide, tech stack, code structure, acknowledgements with diagrams and tutorial modals.
`feature` · 2026-08-11 · web · active
Must stay true: The guide (/guide) has separate pages for the overview/user guide, screens, graph, tools, built-with (tech stack and credits), control flow and licence, with diagrams and a guided tour.
Guarded by:
- `web/src/App.requests-g6.test.ts` › "has the overview, screens, graph, tools, built-with, control flow and licence pages"
- `web/src/App.requests-g6.test.ts` › "routes /guide/%s to its own page, %s"
- `web/src/App.requests-g6.test.ts` › "opens the overview at /guide itself"

### Q081 — On load the robot glitches by moving toward the back; fix.
`fix` · 2026-08-22 · web · active
Must stay true: On load the mascot does not jump toward the back of the scene.
Guarded by: not testable — An on-load glitch in the WebGL scene with no recorded cause; nothing short of rendering the scene can show it is gone (the load-time shake, Q083, is guarded). Reported against the Spline scene, since replaced by a CC BY model drawn with React Three Fiber (JojoRobot.tsx, RobotScene.tsx).

### Q083 — After load the robot makes a sudden shake then acts normal, and the camera zoom-out animation is gone; restore the zoom-out (revert or fix).
`fix` · 2026-08-22 · web · active
Must stay true: After load the mascot has no sudden shake and the camera zoom-out intro still plays.
Note: The zoom-out was the Spline scene's own; the current robot (RobotScene.tsx) has jojo's own — the camera opens close on the visor and pulls back to the bust — timed in rendered frames so a load stall pauses it rather than cutting it, before the greeting bow.
Guarded by:
- `web/src/components/brand/JojoRobot.requests.test.ts` › "never lets idle cut a gesture short (Q031)"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "greets once per scene, so the arrival does not shake (Q083)"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "lets the robot finish rising into place before the greeting (Q083)"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "opens with the camera zoom-out, and always lands it (Q083)"

### Q084 — On pages with no settings icon beside the title (Assistant, Settings, Today) the title sits at the left with no reserved gap.
`fix` · 2026-08-22 · web · active
Must stay true: On pages without a settings button (Assistant, Settings, Today), PageHeader renders the title flush left with no reserved gap.
Guarded by:
- `web/src/components/common/PageHeader.requests.test.ts` › "reserves no gap before its title"
- `web/src/components/common/PageHeader.requests.test.ts` › "includes %s, which passes none"

### Q086 — Settings address field (the page URL) should be non-editable; then M205 says 'actually remove this, not needed'.
`change` · 2026-08-22 · web · active
Must stay true: Settings shows no address field for the page URL.
Guarded by:
- `web/src/routes/Settings.requests.test.ts` › "has no field showing the page’s own address (Q086)"

### Q088 — Remove the bridge pairing code.
`change` · 2026-08-22 · web · active
Must stay true: Settings shows no bridge pairing code.
Guarded by:
- `web/src/routes/Settings.requests.test.ts` › "has no bridge pairing code (Q088)"

### Q091 — Page title was hidden under the navbar on load; page body should start below the navbar while keeping the vanishing-on-scroll behaviour. Not for Android/iOS.
`fix` · 2026-08-22 · web · active
Must stay true: On web, a page's body (and title) starts below the topbar on load, and the topbar still hides on scroll.
Guarded by:
- `web/src/components/layout/AppShell.requests.test.ts` › "puts the topbar in the flow above <main>, so a title starts below it"
- `web/src/components/layout/AppShell.requests.test.ts` › "opens each new page at its top"

### Q100 — Update the guide's Ladder that still describes the bridge.
`fix` · 2026-08-22 · docs · active
Must stay true: The guide's Ladder diagram (guide/overview/Ladder.tsx) describes the current setup and not the old pairing bridge.
Guarded by:
- `web/src/components/guide/overview/Ladder.requests.test.ts` › "says nothing about a bridge or a pairing token"
- `web/src/components/guide/overview/Ladder.requests.test.ts` › "climbs the rungs that exist: browser, backup, local model, document reader, extension"

### Q104 — Change the 'saved here' status to a knowledge-graph icon.
`change` · 2026-08-22 · web · active
Must stay true: The sidebar storage status uses the knowledge-graph icon (Waypoints) and opens the graph.
Guarded by:
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "draws the knowledge-graph icon and opens the graph"

### Q105 — Offline status becomes dynamic, showing a connected icon when an LLM is connected.
`change` · 2026-08-22 · web · active
Must stay true: The sidebar status shows a connected icon exactly when an LLM is connected, and offline otherwise.
Guarded by:
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "shows the connected icon exactly when a model answered"
- `web/src/components/layout/SidebarRuntime.requests.test.ts` › "says connected when connected, and not otherwise"

### Q116 — The extension-saves-a-copy paragraph spans full card width.
`change` · 2026-08-23 · web · active
Must stay true: In Settings, the paragraph about the extension saving a copy spans the full card width.
Guarded by:
- `web/src/routes/Settings.requests.test.ts` › "runs the extension paragraph the full width of its card (Q116)"

### Q117 — Organise the cards Read my documents, Your documents and Local model properly.
`change` · 2026-08-23 · web · active
Must stay true: The Settings cards for reading documents (DocumentReaderPanel), your documents (DocumentsPanel) and the local model (LocalModelPanel) are laid out in an orderly section.
Guarded by:
- `web/src/routes/Settings.requests.test.ts` › "sets the local model and the document reader side by side (Q117)"
- `web/src/routes/Settings.requests.test.ts` › "puts Your documents directly after the data panel (Q117)"

### Q132 — Widen the new-application modal and modals generally (about 75% of the content width, Edit event 25% wider), with the scrollbar touching the modal's right edge.
`change` · 2026-08-23 · web · active
Must stay true: Modals are wide (about 75% of the content width; the Edit event modal 25% wider than before) and their scrollbar touches the modal's right edge.
Guarded by:
- `web/src/components/ui/dialog-width.requests.test.ts` › "is three quarters of the content column"
- `web/src/components/ui/dialog-width.requests.test.ts` › "is what the shared width class applies, past the dialog’s narrow default"
- `web/src/components/ui/dialog-width.requests.test.ts` › "%s uses it"
- `web/src/components/common/Panel.requests.test.ts` › "reads the dialog’s padding"
- `web/src/components/common/Panel.requests.test.ts` › "%s cancels it"

### Q145 — New-user onboarding: basic details first, with tutorial of each component on web and mobile.
`feature` · 2026-08-23 · cross · active
Must stay true: First run collects basic details (WelcomeDetails) and then offers a tour of each component, on web and phone.
Guarded by:
- `web/src/lib/onboarding.requests.test.ts` › "asks for details first, and offers the tour last"
- `web/src/lib/onboarding.requests.test.ts` › "also asks for details first and offers the tour after"

### Q148 — Tools tab in the How to page with details and diagrams.
`feature` · 2026-08-23 · docs · active
Must stay true: The guide has a Tools page (/guide/tools, GuideTools) describing the tools with diagrams.
Guarded by:
- `web/src/App.requests-g6.test.ts` › "routes /guide/%s to its own page, %s"
- `web/src/components/guide/GuideTools.requests-g6.test.ts` › "is titled as the tools page"
- `web/src/components/guide/GuideTools.requests-g6.test.ts` › "explains the tools with diagrams"

### Q149 — GitHub Pages build shows the 2D flaticon robot instead of the 3D mascot; mascot card should not use it.
`fix` · 2026-08-23 · web · active
Must stay true: The production (GitHub Pages) build renders the 3D mascot, never the 2D flaticon robot.
Note: Reported against the Spline scene, whose scene file 404'd under the Pages base path; since replaced by a CC BY model drawn by JojoRobot.tsx and RobotScene.tsx, whose model file is imported through the bundler and fingerprinted, so it resolves under the base path rather than from public/.
Guarded by:
- `web/src/lib/public-assets.test.ts` › "are never addressed by a bare root-absolute path"
- `web/src/components/brand/JojoRobot.requests.test.ts` › "renders the 3D robot, a licensed model served from this app (Q015, Q149)"

### Q153 — Replace mock user Alex Rahman everywhere with Shaswata Mitra details (UA, Santa Clara, links), region US, role Assistant professor.
`change` · 2026-08-24 · web · active
Must stay true: The demo applicant (seedProfile in service/data/profile.ts) is the fictional Lonardo Jenson, the owner's choice of 2026-11-15, in Santa Clara, searching the US for an Assistant professor role; "Alex Rahman" appears nowhere.
Guarded by:
- `service/data/profile.requests.test.ts` › "is in Santa Clara, searching the US for an Assistant professor role"
- `service/data/profile.requests.test.ts` › "names nobody called Alex Rahman, in any demo fixture"
- `service/data/profile.requests.test.ts` › "is called Lonardo Jenson, the name the owner chose"

### Q154 — Web URL fields show a go-to icon at the right that opens the link.
`feature` · 2026-08-24 · web · active
Must stay true: Web URL fields show a go-to icon at their right that opens the link in a new tab.
Guarded by:
- `web/src/components/vault/links/url.test.ts` › "opens a full address unchanged, query string and all"
- `web/src/components/vault/links/url.test.ts` › "refuses a scheme that is not http"
- `web/src/components/common/Field.requests-g6.test.ts` › "appears for a field of type url holding an address openHref accepts"
- `web/src/components/common/Field.requests-g6.test.ts` › "is a link that opens a new tab"
- `web/src/components/common/Field.requests-g6.test.ts` › "sits at the right of the field, which leaves room for it"

### Q156 — Start tour link went to /guide instead of /jojo/guide on GitHub Pages.
`fix` · 2026-08-24 · web · active
Must stay true: The Start tour link and every internal link resolve under the GitHub Pages base path (/jojo/guide, not /guide).
Guarded by:
- `web/src/lib/internal-links.test.ts` › "hands the router the app’s base as its basename"
- `web/src/lib/internal-links.test.ts` › "never uses a bare <a href> for a route the router owns"

### Q157 — Make the guide diagrams look professional (lines look odd).
`change` · 2026-08-24 · web · active
Must stay true: Guide diagrams use clean, consistent connector lines.
Guarded by: not testable — Pure look-and-feel: whether connector lines look clean is a visual judgement no assertion on the source can make.

### Q159 — Tutorial steps: details; connect LLM; MarkItDown test if connected; install extension; each skippable; M332 moves extension after LLM then MarkItDown test.
`feature` · 2026-08-24 · cross · active
Must stay true: The setup steps (SetupSteps) go: details; connect a model; install the extension; MarkItDown test (only if a model is connected); each step can be skipped.
Guarded by:
- `web/src/lib/onboarding.requests.test.ts` › "goes details, model, extension, then the MarkItDown test"
- `web/src/lib/onboarding.requests.test.ts` › "skips the MarkItDown test when no model is connected"
- `web/src/lib/onboarding.requests.test.ts` › "moves on past a step once it has been skipped"
- `web/src/lib/onboarding.requests.test.ts` › "wires a skip to every setup step"

### Q166 — Default theme is dark.
`change` · 2026-08-24 · web · active
Must stay true: The web app starts in the dark theme on first load.
Guarded by:
- `web/src/lib/theme.requests.test.ts` › "is dark when nothing has been chosen"
- `web/src/lib/theme.requests.test.ts` › "is painted dark by index.html before the app runs"

### Q188 — When the user selects NVIDIA in the tutorial dropdown, show NVIDIA terms and state jojo is not liable for NVIDIA policy breaches.
`feature` · 2026-08-25 · web · active
Must stay true: Choosing NVIDIA in setup shows the NVIDIA terms and says jojo is not liable for breaches of NVIDIA policy (CloudTerms).
Guarded by:
- `service/kg/core/cloud-terms.test.ts` › "keeps the two clauses of NVIDIA’s terms that are in tension with this app"
- `service/kg/core/cloud-terms.test.ts` › "always names who is party to the agreement"
- `service/kg/core/cloud-terms.requests.test.ts` › "says jojo accepts no liability for a breach of NVIDIA’s terms"
- `web/src/components/settings/CloudTerms.requests.test.ts` › "the setup step for a model is the model panel itself"
- `web/src/components/settings/CloudTerms.requests.test.ts` › "the model panel shows the terms for any cloud provider chosen"

### Q189 — When the user selects any other cloud LLM, state that data will no longer be private with that provider, naming the provider.
`feature` · 2026-08-25 · web · active
Must stay true: Choosing any other cloud model provider in setup says, naming the provider, that data sent to it is no longer private.
Guarded by:
- `service/kg/core/cloud-terms.requests.test.ts` › "covers every one there is"
- `service/kg/core/cloud-terms.requests.test.ts` › "says, naming it, that the records leave this device"
- `service/kg/core/cloud-terms.requests.test.ts` › "names it again as the party whose terms apply"
- `web/src/components/settings/CloudTerms.requests.test.ts` › "the terms box renders the headline, the paragraphs, the liability line and the provider’s own terms"

### Q202 — Update How to with details and working functionality of the workflow engine.
`change` · 2026-08-25 · web · active
Must stay true: The guide describes the workflow engine and how it runs.
Guarded by:
- `web/src/components/guide/GuideTools.requests-g6.test.ts` › "has a section on it"
- `web/src/components/guide/GuideTools.requests-g6.test.ts` › "says how it runs: steps joined by edges, retried one at a time, optional ones skippable, with a cap"

### Q234 — 'useNavigate() may be used only in the context of a Router' crashes a view; fix.
`fix` · 2026-09-11 · web · active
Must stay true: Every component that calls useNavigate renders inside the Router (check-outside-router.test.ts).
Guarded by:
- `web/src/lib/check-outside-router.test.ts` › "passes: nothing drawn outside the router uses it"
- `web/src/lib/check-outside-router.test.ts` › "would have caught the 2026-09-11 crash"

### Q259 — When a kanban card moves forward, the sidebar mascot randomly dances, nods or spins.
`feature` · 2026-09-14 · web · superseded
Must stay true: n/a (superseded).
Note: Replaced by Q323 (2026-11-15): each stage now has its own gesture rather than a random one — a draft sent off dances, an interview powers up — and Closed plays by outcome.

### Q267 — Add a color palette/picker anywhere the user chooses a color (keyword, text editor text color, etc.), allowing any color from the spectrum beyond the 8 presets, and make chosen colors persist wherever used.
`feature` · 2026-09-14 · web · active
Must stay true: Every colour choice (keyword colours, text colour in the editor, and others) offers a full-spectrum picker (SpectrumSwatch) beside the presets, and a chosen colour persists and renders the same after reload.
Guarded by:
- `web/src/components/common/SpectrumSwatch.requests.test.ts` › "beside the eight keyword colours"
- `web/src/components/common/SpectrumSwatch.requests.test.ts` › "in the editor’s text colour menu"
- `service/kg/core/validate-props-vault.requests.test.ts` › "is kept in one spelling, so it renders the same after a reload"
- `service/kg/core/validate-props-vault.requests.test.ts` › "refuses something that is not a colour, rather than storing it"
- `service/kg/core/note-format.test.ts` › "round-trips a hex through the one colour slot"

### Q268 — Application Notes (and every text edit area, including snippets) should get the rich text editor features (bold, italics, size, color, etc.) and these formats must persist with the saved text.
`feature` · 2026-09-14 · web · active
Must stay true: Every note field — application notes (detail panel and edit dialog), the offer note on a stage move, timeline item notes, person notes — and snippets use the rich text editor; size, colour, bold, italic, underline and strikethrough persist beside the plain text (noteFormat / offerNoteFormat / bodyFormat), and records saved before formatting existed open as exactly their text.
Guarded by:
- `web/src/lib/note-html.test.ts` › "puts the span on the right characters"
- `web/src/lib/note-html.test.ts` › "keeps it through the spelling the DOM hands back"
- `web/src/components/common/RichTextEditor.requests-g6.test.ts` › "is edited in the rich text editor, opened on its stored formatting"
- `web/src/components/common/RichTextEditor.requests-g6.test.ts` › "saves the formatting with the text"
- `web/src/components/common/RichTextEditor.requests-g6.test.ts` › "saves the formatting with the text, on edit and on create"
- `service/kg/tools/rich-notes.requests.test.ts` › "saves the formatting sent with it, on create and on edit"
- `service/kg/tools/rich-notes.requests.test.ts` › "moves the formatting when only the text is sent, rather than leaving it on other words"
- `service/kg/tools/rich-notes.requests.test.ts` › "leaves an item saved before formatting existed exactly as it was"
- `service/kg/tools/rich-notes.requests.test.ts` › "saves the formatting with the offer"
- `service/kg/tools/rich-notes.requests.test.ts` › "loads a record saved before the format props existed, unchanged"
- `service/kg/tools/rich-notes.requests.test.ts` › "drops a malformed one on restore and keeps the record"
- `web/src/components/common/RichTextEditorField.requests.test.ts` › "opens a note saved before notes could be formatted as exactly its text"
- `web/src/components/common/RichTextEditorField.requests.test.ts` › "hands the form the text and the formatting, encoded"
- `web/src/components/common/RichTextEditorField.requests.test.ts` › "a timeline item opens on its stored formatting and saves it, on edit and on create"
- `web/src/components/common/RichTextEditorField.requests.test.ts` › "a person opens on their stored formatting and saves it"
- `web/src/components/common/RichTextEditorField.requests.test.ts` › "no longer says the formatting is thrown away, because it is saved"

### Q271 — The left sidebar vibrates weirdly in both themes; owner decided to undo the last commit and remove the research preview text from the left sidebar.
`fix` · 2026-09-14 · web · active
Must stay true: The left sidebar shows no research-preview text.
Guarded by:
- `web/src/components/layout/Sidebar.requests.test.ts` › "%s renders no research-preview text"

### Q282 — The palette closes when changing color on selected text or on any click, and the picker circle cannot be dragged with the mouse (e.g. cannot set white in application details).
`fix` · 2026-10-05 · web · active
Must stay true: Clicking or dragging inside the colour picker keeps it open and keeps the text selection, and the picker circle can be dragged to any colour, white included.
Guarded by:
- `service/kg/core/ink.test.ts` › "reads the corners the way the square is drawn"
- `service/kg/core/ink.test.ts` › "clamps a drag past the edge to the edge"
- `web/src/components/common/SpectrumSwatch.requests.test.ts` › "keeps focus and the text selection where they were on a click"
- `web/src/components/common/SpectrumSwatch.requests.test.ts` › "captures the pointer, so a drag survives leaving the popover"
- `web/src/components/common/SpectrumSwatch.requests.test.ts` › "applies the colour once, on release, rather than on every frame"
- `web/src/components/common/SpectrumSwatch.requests.test.ts` › "maps the square’s top-left corner to white"

### Q286 — Light theme containers blend together because everything is too white; then the white is too bright and should be slightly dimmer to ease eyes.
`fix` · 2026-10-10 · web · active
Must stay true: In the light theme, cards and containers use surface tokens distinct from the page background, and the base white is a slightly dimmed off-white.
Guarded by:
- `web/src/index.requests-g6.test.ts` › "sets cards apart from the page they sit on"
- `web/src/index.requests-g6.test.ts` › "dims the base white to an off-white"

### Q310 — Create a hierarchical code/control flow graph and add it as a page; it should be named Control flow graph, not FAQ.
`feature` · 2026-11-12 · docs · active
Must stay true: The guide has a Control flow graph page (/guide/control-flow, GuideControlFlow) with the hierarchical code flow graph, and /guide/faq redirects to it.
Guarded by:
- `web/src/App.requests-g6.test.ts` › "redirects the old FAQ page to the Control flow graph"
- `web/src/components/guide/GuideControlFlow.requests.test.ts` › "is named Control flow graph, not FAQ"
- `web/src/components/guide/GuideControlFlow.requests.test.ts` › "draws the hierarchical code graph and the journey graphs"

### Q311 — FAQ page paragraphs should use the full container width when available.
`fix` · 2026-11-12 · web · active
Must stay true: Paragraphs on the Control flow graph page use the full container width when space allows.
Guarded by:
- `web/src/components/guide/GuideControlFlow.requests.test.ts` › "use the full width of their container"


## Build, release, offline and licences

### Q001 — Self-host fonts instead of loading them from the Google CDN, since the app is self hosted.
`change` · 2026-08-07 · build · active
Must stay true: No source or CSS references fonts.googleapis.com or fonts.gstatic.com; every font face is served from the app's own files.
Guarded by:
- `web/src/index.requests-g7.test.ts` › "names no Google Fonts host anywhere the app ships from"
- `web/src/index.requests-g7.test.ts` › "imports both faces from the self-hosted fontsource packages"

### Q002 — Update the README with code structure and how to run.
`change` · 2026-08-07 · docs · active
Must stay true: The root README.md documents the code structure (web, service, mobile, extension, bridge) and how to run each part.
Guarded by:
- `service/test/readme.requests.test.ts` › "lays out the three workspaces, and names the extension and the bridge"
- `service/test/readme.requests.test.ts` › "says how to run the web app and the mobile app"

### Q066 — Use MVC: platform-independent service layer shared across web, mobile and Electron.
`change` · 2026-08-09 · cross · active
Must stay true: The platform-independent service layer (service/kg/core, agent, tools) imports no web or React Native APIs (check-platform guard), and web and mobile both build on it.
Guarded by:
- `service/test/lint-guards.requests.test.ts` › "Q066: keeps the service layer free of web, React Native and Node APIs"
- `service/test/package.requests.test.ts` › "has web and mobile depend on the service workspace rather than carry it"
- `web/src/components/guide/code-graph.test.ts` › "never has the shared service importing from an app"

### Q076 — Split huge source files into properly modular files, including the hotspot files and the four named service files, to production standard.
`change` · 2026-08-11 · cross · active
Must stay true: Source files stay modular: the hotspot files and the four named service files are split into focused modules, and the gate's size/structure checks pass.
Guarded by:
- `service/test/lint-guards.requests.test.ts` › "Q076: keeps imports one-directional across layers and free of value cycles"
- `web/src/components/guide/code-graph.test.ts` › "never has a service layer importing from a layer above it"

### Q079 — Move shared code into a service folder imported by both platforms.
`change` · 2026-08-17 · cross · active
Must stay true: Shared code lives in the service/ package and both web and mobile import it as @jojo/service rather than keeping copies.
Guarded by:
- `service/test/package.requests.test.ts` › "has web and mobile depend on the service workspace rather than carry it"
- `service/test/lint-guards.requests.test.ts` › "Q079: finds one copy of the service layer, reached only through its exports"

### Q130 — Fix the bug (no referent given).
`fix` · 2026-08-23 · cross · process
Must stay true: n/a (process).
Note: Message is only "Fix the bug"; no referent.; from C2-050

### Q133 — Make the app production-ready for 0.1.0: modular, no dead code, documented; How to page up to date with all tools, functionality and third-party citations.
`change` · 2026-08-23 · cross · active
Must stay true: The guide lists every tool and function and cites every third-party component (credits.ts, checked by credits.test.ts), for the 0.1.0 release.
Guarded by:
- `web/src/components/guide/credits.test.ts` › "names every production dependency of the web app"
- `web/src/components/guide/credits.test.ts` › "credits every package the reviewed production build shipped"
- `web/src/components/guide/GuideTools.requests-g7.test.ts` › "reads the tool total from the catalog it describes"
- `web/src/components/guide/GuideTools.requests-g7.test.ts` › "prints no hand-typed tool count in its text"
- `web/src/components/guide/GuideTools.requests-g7.test.ts` › "keeps a typed tool count out of the rail blurb too"

### Q134 — A GitHub Actions workflow runs all tests, deploys the site to GitHub Pages, and builds the Android APK and publishes it for download.
`feature` · 2026-08-23 · build · active
Must stay true: .github/workflows/ci.yml runs the gate on push to main, deploys the site to GitHub Pages behind it, and builds an Android APK that a tagged release attaches for download.
Guarded by:
- `service/test/ci.requests.test.ts` › "runs every workspace’s typecheck, lint and tests in the gate job"
- `service/test/ci.requests.test.ts` › "deploys the site to GitHub Pages only behind the gate, and only from main"
- `service/test/ci.requests.test.ts` › "builds the release APK behind the gate and publishes it as an artifact"
- `service/test/ci.requests.test.ts` › "attaches the APK to a release on a version tag"

### Q135 — Cover the service/logic layer end to end with tests, including negative scenarios.
`feature` · 2026-08-23 · service · active
Must stay true: The service layer has end-to-end and negative-case tests for its tools, run by the gate with coverage floors.
Guarded by:
- `service/test/coverage.test.ts` › "has no tool that no test anywhere exercises"
- `service/test/ci.requests.test.ts` › "gates on test:coverage, and the floors it enforces are declared"

### Q136 — Resolve lint warnings (unneeded spreads, unused identifiers) and platform-check violations from probe test files; address npm deprecation/vulnerability output.
`fix` · 2026-08-23 · build · active
Must stay true: Lint passes with zero warnings in service, web and mobile, and a new warning fails it (oxlint --deny-warnings); unicorn/no-useless-spread is on in all three configs; no unused identifiers; probe test files do not violate the platform check.
Guarded by:
- `service/test/lint-guards.requests.test.ts` › "finds no unused identifier in any workspace"
- `service/test/lint-guards.requests.test.ts` › "Q066: keeps the service layer free of web, React Native and Node APIs"
- `service/test/lint-guards.requests.test.ts` › "finds no warning or error under each workspace’s own lint config"
- `service/test/lint-guards.requests.test.ts` › "turns unicorn/no-useless-spread on in every workspace’s lint config"
- `service/test/lint-guards.requests.test.ts` › "fails each workspace’s lint on a warning, not only on an error"

### Q138 — Fix the GitHub Pages deployment failure (Pages not enabled / configure-pages error).
`fix` · 2026-08-23 · build · active
Must stay true: The Pages deploy job in ci.yml does not fail at configure-pages.
Guarded by:
- `service/test/ci.requests.test.ts` › "holds the two permissions deploy-pages needs and asks configure-pages to enable the site"

### Q143 — Both (packages) versions are 0.1.0.
`change` · 2026-08-23 · build · active
Must stay true: The root, web, service, mobile and extension package versions are all 0.1.0.
Guarded by:
- `service/test/package.requests.test.ts` › "gives the root, web, service, mobile and the extension the same version, 0.1.0"
- `web/src/lib/extension-manifest.test.ts` › "carries the same version as the app it belongs to"

### Q144 — Update each platform's and the extension's README to be correct.
`change` · 2026-08-23 · docs · active
Must stay true: Each platform README and the extension README describe the current code and commands.
Guarded by:
- `service/test/readme.requests.test.ts` › "names only npm scripts that exist, in every README"
- `service/test/readme.requests.test.ts` › "reads the npm-run pattern on both sides of the workspace flag"
- `service/test/readme.requests.test.ts` › "names no path that only exists because a file is gitignored"

### Q158 — Describe jojo as an agentic application, not just a tracker.
`change` · 2026-08-24 · docs · active
Must stay true: README and the guide describe jojo as an agentic application, not only a tracker.
Guarded by:
- `service/test/readme.requests.test.ts` › "says so in the README"

### Q160 — Fix the critical, then major, then moderate issues from the audit.
`fix` · 2026-08-24 · cross · process
Must stay true: n/a (process).
Note: Fixes from the M306 audit; contents not enumerated.; from C2-081

### Q167 — Thorough UX/UI/code audit and fix to make production ready.
`change` · 2026-08-24 · cross · process
Must stay true: n/a (process).
Note: Production-readiness audit; no specific outcome.; from C2-088

### Q174 — Crashlytics on all platforms with config toggle; tutorial last page asks opt-in, explaining only crash data.
`feature` · 2026-08-24 · cross · active
Must stay true: Crashlytics reports only crash data and only after opt-in: the last setup step asks, and Settings (CrashPanel) can toggle it, on all platforms.
Guarded by:
- `web/src/components/common/Onboarding.requests.test.ts` › "asks on the web as the last setup step, after the others and before the tour"
- `web/src/components/common/Onboarding.requests.test.ts` › "asks on the phone before the tour, too"
- `web/src/components/common/Onboarding.requests.test.ts` › "lets Settings turn crash reports and usage on and off, on both platforms"
- `mobile/src/lib/reporting-consent.test.ts` › "is off on a fresh install, where the question has not been asked yet"
- `service/kg/core/crash.test.ts` › "is off unless BOTH the build allows it and the user turned it on"
- `web/src/lib/analytics.requests.test.ts` › "stays off before the reporting question has been asked"

### Q175 — Add Firebase Analytics for feature usage.
`feature` · 2026-08-24 · cross · active
Must stay true: Firebase Analytics records feature-usage events only when enabled (analytics.ts, analytics-optout.test.ts).
Guarded by:
- `web/src/lib/analytics.requests.test.ts` › "stays off before the reporting question has been asked, whatever the build allows"
- `web/src/lib/analytics.requests.test.ts` › "is on once asked and not declined, and off again once declined"
- `web/src/lib/analytics.requests.test.ts` › "stays off in a build without the capability, even after a yes"
- `service/kg/core/analytics.test.ts` › "accepts only the events declared here"
- `web/src/lib/analytics-optout.test.ts` › "expires the GA cookies on whichever domain gtag set them"

### Q176 — Add App Distribution and Test Lab.
`feature` · 2026-08-24 · build · active
Must stay true: ci.yml distributes builds through Firebase App Distribution and runs Firebase Test Lab.
Guarded by:
- `service/test/ci.requests.test.ts` › "sends the release APK to testers through App Distribution"
- `service/test/ci.requests.test.ts` › "runs the instrumentation suite on Test Lab against the release APK, on pushes to main"

### Q180 — Run the test cases in Firebase Test Lab, invoked from GitHub Actions so the full pipeline is automatic.
`feature` · 2026-08-24 · build · active
Must stay true: ci.yml runs the instrumentation tests in Firebase Test Lab against the release APK on push.
Guarded by:
- `service/test/ci.requests.test.ts` › "runs the instrumentation suite on Test Lab against the release APK, on pushes to main"

### Q182 — The deployed GitHub Pages build said it was built without crash reporting; the build must receive CRASH_REPORTING, ANALYTICS and Firebase config from repository variables.
`fix` · 2026-08-24 · build · active
Must stay true: The web build in ci.yml receives VITE_CRASH_REPORTING, VITE_ANALYTICS and the VITE_FIREBASE_* config from repository vars.
Guarded by:
- `service/test/ci.requests.test.ts` › "maps CRASH_REPORTING, ANALYTICS and every Firebase value from vars into the build"
- `service/test/ci.requests.test.ts` › "passes every VITE_ variable the web app’s reporting code reads"

### Q187 — Add a sixth License tab in the How to page stating the open source licence, free use, and disclaimers about NVIDIA, Microsoft and other third-party licences.
`feature` · 2026-08-25 · web · active
Must stay true: The guide has a Licence page (/guide/licence, GuideLicence) stating the open-source licence and free use, with disclaimers for NVIDIA, Microsoft and other third-party licences.
Guarded by:
- `web/src/components/guide/GuideLicence.requests.test.ts` › "is a guide page of its own, at /guide/licence"
- `web/src/components/guide/GuideLicence.requests.test.ts` › "states the open-source licence and that use is free"
- `web/src/components/guide/GuideLicence.requests.test.ts` › "carries a disclaimer for NVIDIA, Microsoft and the other third parties"

### Q192 — Capture errors of any type, excluding personal data, in Crashlytics or Analytics as appropriate.
`feature` · 2026-08-25 · cross · active
Must stay true: Errors of any kind are reported to Crashlytics or Analytics (report-error.ts, crash-log.ts) with personal data (profile, conversations, keys, addresses, emails) stripped, and only when the user opted in.
Guarded by:
- `web/src/lib/crash-log.requests.test.ts` › "keeps a report of any thrown value, with the email and the key stripped"
- `web/src/lib/crash-log.requests.test.ts` › "keeps nothing once the person has turned reporting off"
- `web/src/lib/crash-log.requests.test.ts` › "keeps nothing in a build without the capability, whatever the setting says"
- `service/kg/core/crash.test.ts` › "removes an email address"
- `service/kg/core/crash.test.ts` › "removes a vendor key by its own prefix, wherever it appears"
- `service/kg/core/analytics.test.ts` › "classifies a caught error without reading its message"

### Q203 — Triage and make changes for best agentic UX, fix remaining audit issues except spline, tuned for smaller LLMs.
`change` · 2026-08-25 · cross · process
Must stay true: n/a (process).
Note: Triage of an audit not in the messages; no specific outcome. (The Spline issue it excepted — a runtime with no licence grant — was later closed by replacing the mascot with jojo's own R3F robot.); from C3-030

### Q208 — Do the 4-file move for seed.ts now and defer the rename.
`change` · 2026-08-26 · service · process
Must stay true: n/a (process).
Note: A one-off file move (seed.ts) chosen from an assistant recommendation.; from C3-036

### Q209 — Audit all three platforms and fix everything found, following industry standards.
`fix` · 2026-08-26 · cross · process
Must stay true: n/a (process).
Note: Audit of all three platforms; review contents not in the messages.; from C3-037

### Q210 — CI docs check fails on paths to files not in the repository; fix.
`fix` · 2026-08-26 · build · active
Must stay true: The CI docs check passes and does not reference files missing from the repository.
Guarded by:
- `service/test/readme.requests.test.ts` › "names no path that only exists because a file is gitignored"

### Q212 — The last push did not trigger the GitHub Actions CI build; make pushes trigger it.
`fix` · 2026-08-27 · build · active
Must stay true: ci.yml triggers on every push to main.
Guarded by:
- `service/test/ci.requests.test.ts` › "triggers on every push to main, with no path filter that could skip one"

### Q221 — Run the experiments (output budget, constrained decoding, etc.) and fix the rest of the planned items.
`change` · 2026-08-27 · service · process
Must stay true: n/a (process).
Note: Run planned experiments; list truncated, no specific outcome.; from C3-051

### Q223 — Audit the full codebase for bugs and practice violations and fix all findings.
`fix` · 2026-08-28 · cross · process
Must stay true: n/a (process).
Note: Full-codebase audit; review contents not in the messages.; from C3-053

### Q224 — Test with all live models.
`change` · 2026-09-03 · service · process
Must stay true: n/a (process).
Note: An instruction to run the benchmark on all live models.; from C3-054

### Q226 — Licence text must not allow commercial use and must disclaim liability.
`change` · 2026-09-06 · docs · superseded
Must stay true: n/a (superseded).
Note: Licence switched to Apache 2.0 in M422 (Q227).; from C3-056

### Q227 — Switch the licence to Apache 2.0.
`change` · 2026-09-06 · docs · active
Must stay true: LICENSE is Apache 2.0, and the package manifests and the guide Licence page say Apache-2.0.
Guarded by:
- `service/test/package.requests.test.ts` › "ships the Apache License 2.0 text as LICENSE"
- `service/test/package.requests.test.ts` › "declares Apache-2.0 in every package manifest"
- `web/src/components/guide/GuideLicence.requests.test.ts` › "names Apache-2.0 in its subtitle and its own-licence heading"

### Q231 — State clearly that the platform is work in progress for research and testing only, discourages copyright or distribution, and the owners are not liable.
`change` · 2026-09-09 · web · active
Must stay true: The Licence page states the platform is work in progress for research and testing only, discourages copying or redistribution, and that the owners are not liable.
Guarded by:
- `web/src/components/guide/GuideLicence.requests.test.ts` › "renders the shared notice, headline, summary and every point"
- `web/src/components/guide/GuideLicence.requests.test.ts` › "says work in progress, research and testing, asks against redistribution, and disclaims liability"
- `service/kg/core/status.test.ts` › "does not claim to restrict what the licence grants"
- `service/kg/core/status.test.ts` › "says the three things a reader needs before trusting it"

### Q258 — Audit for practices, bugs, modularity and documentation, then fix the bugs.
`fix` · 2026-09-13 · cross · process
Must stay true: n/a (process).
Note: Audit for practices, bugs and docs; review contents not in the messages.; from C3-092

### Q273 — Android build fails in CI: sdkmanager cannot find package 'tools' in setup-android.
`fix` · 2026-09-14 · build · active
Must stay true: The Android CI job's SDK setup step does not request the nonexistent sdkmanager package "tools".
Guarded by:
- `service/test/ci.requests.test.ts` › "does not ask sdkmanager for the withdrawn "tools" package"

### Q309 — Thoroughly review the full codebase for industry practice and bugs, then fix everything except phone-only (mobile) issues.
`fix` · 2026-11-12 · cross · process
Must stay true: n/a (process).
Note: Full-codebase review (mobile excluded); findings not in the messages.; from C4-049


## Phone app

### Q063 — Build an interactive mobile prototype matching the web, then audit for mobile and tablet.
`feature` · 2026-08-09 · mobile · active
Must stay true: The phone app covers the web app's user journeys.
Guarded by: not testable — Journey-by-journey parity with the web is judged by using the app on a phone and tablet; no device runs here and D20 forbids mounting the screens, so there is no single fact a source guard could pin.

### Q067 — Fix Expo Go incompatibility on Samsung S23 Android 16 with SDK 54.
`fix` · 2026-08-09 · mobile · superseded
Must stay true: n/a (superseded).
Note: Expo was dropped altogether (Q069).; from C1-067

### Q068 — Fix all todo items except wiring the mobile UI.
`change` · 2026-08-09 · mobile · process
Must stay true: n/a (process).
Note: "Fix all todo items except wiring the mobile UI" names no outcome.; from C1-068

### Q069 — Build the phone app as native Android and iOS projects and remove Expo completely.
`change` · 2026-08-09 · mobile · active
Must stay true: mobile/package.json has no expo dependency and mobile/android and mobile/ios are native projects.
Guarded by:
- `mobile/src/lib/native-build.requests.test.ts` › "has no expo package among its dependencies"
- `mobile/src/lib/native-build.requests.test.ts` › "runs through the React Native CLI, not expo"
- `mobile/src/lib/native-build.requests.test.ts` › "has no Expo config files"
- `mobile/src/lib/native-build.requests.test.ts` › "carries no Expo code"
- `mobile/src/lib/native-build.requests.test.ts` › "names Expo in Metro only to cut the optional expo-font edge out of the bundle"
- `mobile/src/lib/native-build.requests.test.ts` › "is a React Native Android application project"
- `mobile/src/lib/native-build.requests.test.ts` › "is a React Native iOS Xcode project"

### Q070 — Dark is the default theme on mobile unless user switches.
`change` · 2026-08-09 · mobile · active
Must stay true: The phone app starts in the dark theme unless the user switches.
Guarded by:
- `mobile/src/theme/theme-pref.requests.test.ts` › "is dark on a phone whose OS is set to light"
- `mobile/src/theme/theme-pref.requests.test.ts` › "is dark whatever the OS reports, including nothing"
- `mobile/src/theme/theme-pref.requests.test.ts` › "is what ThemeProvider seeds its state with"
- `mobile/src/theme/theme-pref.requests.test.ts` › "keeps light once the person picks light, even on a dark OS"

### Q071 — Cards on board can be held and dragged to another phase.
`fix` · 2026-08-09 · mobile · active
Must stay true: On the phone board, a long-press drags a card to another stage column and the stage change persists.
Guarded by:
- `mobile/src/lib/board-drop.test.ts` › "lands the card on the column the finger was over"
- `mobile/src/lib/board-drop.test.ts` › "lands nothing when the drag was cancelled rather than released"
- `mobile/src/lib/board-drop.requests.test.ts` › "lifts a card on a long press, not on a plain pan"
- `mobile/src/lib/board-drop.requests.test.ts` › "moves the held card to the stage dropStage answers"
- `mobile/src/lib/board-drop.requests.test.ts` › "persists the move through the shared setStage"

### Q072 — The phone app is responsive across phones and tablets, uses device orientation (portrait/landscape), and no text overflows card areas.
`fix` · 2026-08-09 · mobile · active
Must stay true: The phone app reflows for phone and tablet widths and for portrait/landscape rotation, and no text overflows its card.
Guarded by:
- `mobile/src/lib/layout-math.test.ts` › "gets two columns once the device is wide enough"
- `mobile/src/lib/layout-math.test.ts` › "caps at the readable width instead of spanning the device"
- `mobile/src/lib/layout-math.test.ts` › "reports landscape from the dimensions rather than a stored flag"
- `mobile/src/lib/layout-math.test.ts` › "runs two columns on its side and one upright"
- `mobile/src/lib/layout-math.requests.test.ts` › "leaves the Android activity free to rotate"
- `mobile/src/lib/layout-math.requests.test.ts` › "lists both portrait and landscape under iOS"
- `mobile/src/lib/layout-math.requests.test.ts` › "lays out from useWindowDimensions, which re-renders on rotation"

### Q074 — Reuse the shared service layer (including its React code) so the browser-only web features and the phone app are fully functional.
`feature` · 2026-08-10 · cross · active
Must stay true: The phone app uses the shared service layer (service/kg, including its React hooks) for its data and features, and every browser-only web feature (storage, retrieval, update) works with no server.
Guarded by:
- `mobile/src/kg/storage/rn-conformance.test.ts` › "seeds, writes, closes, reopens, and hands back exactly what went in"
- `service/kg/storage/driver-conformance.ts` › "hands the rows back to a second connection to the same store"
- `mobile/src/lib/store.requests.test.ts` › "mounts the shared KgProvider over the shared boot and the AsyncStorage driver"
- `mobile/src/lib/store.requests.test.ts` › "keeps no copy of the graph layer under mobile/src/kg"
- `mobile/src/lib/store.requests.test.ts` › "depends on the @jojo/service workspace"

### Q077 — Fix Android gradle/JVM compatibility with stable versions.
`fix` · 2026-08-15 · mobile · active
Must stay true: The Android Gradle build uses stable Gradle/AGP and JDK 17 (as in ci.yml) and assembles.
Guarded by:
- `mobile/src/lib/native-build.requests.test.ts` › "wraps a stable Gradle release, the one React Native builds its own plugin with"
- `mobile/src/lib/native-build.requests.test.ts` › "takes AGP from React Native rather than pinning its own"
- `mobile/src/lib/native-build.requests.test.ts` › "uses the Kotlin React Native builds against"
- `mobile/src/lib/native-build.requests.test.ts` › "builds the Android APK in CI on Temurin JDK 17"

### Q080 — Web, Android and iOS stay in sync and work end to end.
`change` · 2026-08-18 · cross · process
Must stay true: n/a (process).
Note: An instruction to test web/Android/iOS end to end; no specific outcome.; from C1-081

### Q150 — Use the favicon as the Android and iOS app icon.
`change` · 2026-08-23 · mobile · active
Must stay true: The Android and iOS app icons are the jojo favicon robot.
Guarded by:
- `mobile/src/lib/app-icons.requests.test.ts` › "draws with the favicon colours"
- `mobile/src/lib/app-icons.requests.test.ts` › "layers are the mark, redrawn exactly"
- `mobile/src/lib/app-icons.requests.test.ts` › "iOS App Store icon is the mark, redrawn exactly and opaque"
- `mobile/src/lib/app-icons.requests.test.ts` › "is the icon both apps actually use"

### Q152 — Make the agent functionality fully work on mobile.
`feature` · 2026-08-24 · mobile · active
Must stay true: The agent (chat, tools, approvals) works on the phone app as on web.
Guarded by:
- `mobile/src/lib/llm.requests.test.ts` › "sends the tool catalogue to the model"
- `mobile/src/lib/llm.requests.test.ts` › "hands the model tool calls back to the loop, arguments parsed"
- `mobile/src/lib/llm.requests.test.ts` › "does not send at all when no model is configured"
- `mobile/src/lib/llm.requests.test.ts` › "drives the shared useAgent loop with agentTurn"
- `mobile/src/lib/llm.requests.test.ts` › "mounts the shared run provider and an approval sheet over the shared run context"

### Q177 — Add Google services gradle plugin and Firebase deps and gitignore google-services.json.
`feature` · 2026-08-24 · mobile · active
Must stay true: The Android Gradle build applies the Google services plugin and Firebase dependencies, and google-services.json is gitignored.
Guarded by:
- `mobile/src/lib/native-build.requests.test.ts` › "puts the Google services and Crashlytics Gradle plugins on the classpath"
- `mobile/src/lib/native-build.requests.test.ts` › "applies both plugins in the app module when google-services.json is present"
- `mobile/src/lib/native-build.requests.test.ts` › "depends on the Firebase app, analytics and crashlytics modules"
- `mobile/src/lib/native-build.requests.test.ts` › "git ignores"

### Q183 — Analytics must be enabled on iOS too (IS_ANALYTICS_ENABLED was false in the plist).
`fix` · 2026-08-24 · mobile · active
Must stay true: iOS builds report analytics: CI sets IS_ANALYTICS_ENABLED to YES in the GoogleService-Info.plist it decodes from the secret (the local, gitignored copy was flipped by hand on 2026-11-15).
Guarded by:
- `service/test/ci.requests.test.ts` › "switches IS_ANALYTICS_ENABLED on in the Firebase plist CI puts in place"

### Q229 — First-use demo records crashes with 'Couldn't find navigation object'; fix.
`fix` · 2026-09-06 · mobile · active
Must stay true: The phone app's first-use demo-records screen renders inside the navigation container and does not crash with "Couldn't find navigation object".
Guarded by:
- `mobile/src/lib/store.requests.test.ts` › "draws FirstRunChoice and Onboarding from StoreProvider, outside the navigator"
- `mobile/src/lib/store.requests.test.ts` › "reaches no useNavigation from"

### Q230 — Make the MarkItDown reader work on Android and iOS, where extensions cannot be installed.
`feature` · 2026-09-06 · mobile · active
Must stay true: The MarkItDown reader works on Android and iOS without a browser extension (mobile/src/lib/markitdown.ts).
Guarded by:
- `mobile/src/lib/markitdown.test.ts` › "decodes a percent-encoded URI before touching the filesystem"
- `mobile/src/lib/markitdown.requests.test.ts` › "reads a DOCX on the handset with no reader address and no request"
- `mobile/src/lib/markitdown.requests.test.ts` › "reads a plain text file on the handset too"
- `mobile/src/lib/markitdown.requests.test.ts` › "sends a PDF to the configured MarkItDown over the phone transport"

### Q331 — Show the web's sticky notes and hand-edited stage dates on the phone too.
`feature` · 2026-11-16 · mobile · active
Must stay true: Today's recent card toggles to the sticky-notes board, notes by default and remembered per device, on the same store the web board uses (`useStickyNotes`); a note becomes a reminder through core's `reminderFromNote`. An application's details screen shows `StageDatesPanel`, one row per stage `stagesToDate` picks, each a date that can be picked or cleared through `setStageDate`, with an Undo; the read-only Submitted on fact is gone, as on the web.
Guarded by:
- `mobile/src/lib/notes-and-stage-dates.requests.test.ts` › "toggles the recent card to the notes, and shows the notes unless this device chose the list"
- `mobile/src/lib/notes-and-stage-dates.requests.test.ts` › "keeps its notes in the same store the web board does"
- `mobile/src/lib/notes-and-stage-dates.requests.test.ts` › "turns a note into a reminder through the shared rule"
- `mobile/src/lib/notes-and-stage-dates.requests.test.ts` › "shows each stage’s date on the record, submitted included, and once"
- `mobile/src/lib/notes-and-stage-dates.requests.test.ts` › "writes a picked or cleared date through the rule that overwrites, with an Undo"
- `service/kg/core/sticky.test.ts` › "takes the first line as the title and the rest as the detail"
Note: The owner's answer to the question Q328 left open. `reminderFromNote` moved from the web app's lib folder to `service/kg/core/sticky.ts` so both boards share it. Wording is the web's catalog entries copied into the phone's ten locales; the phone drops "(Enter to stick it)" from the placeholder, because Return adds a line on a phone keyboard.

### Q332 — Add Bengali and other popular languages too.
`feature` · 2026-11-16 · cross · active
Must stay true: Both apps offer twenty languages from the one list in `service/kg/core/locale.ts` — the first ten plus Bengali, Russian, Urdu (right-to-left), Indonesian, Turkish, Vietnamese, Italian, Traditional Chinese, Marathi and Tamil — each with every key English has, its own CLDR plural forms, and the calendar words taken from CLDR. A Traditional Chinese device (zh-TW, zh-HK, zh-Hant) gets Traditional Chinese instead of English, and the phone's PluralRules shim answers every one of the twenty languages the way ICU does.
Guarded by:
- `service/kg/core/locale.test.ts` › "offers Bengali and the other most-spoken languages"
- `service/kg/core/locale.test.ts` › "reads Chinese by script, and never shows Simplified to a Traditional reader"
- `service/kg/core/locale.test.ts` › "marks Arabic and Urdu right-to-left and nothing else"
- `web/src/i18n/catalogs.test.ts` › "has a folder for every offered language and none for anything else"
- `mobile/src/i18n/catalogs.test.ts` › "has a folder for every offered language and none for anything else"
- `mobile/src/lib/plural-rules.test.ts` › "gives i18next the right forms when the engine has no PluralRules"
Note: Chosen by number of speakers among languages the app did not yet offer, plus Traditional Chinese, whose readers were sent to English. Translated by one agent per language against a shared brief and validator (keys, placeholders, CLDR plural sets, tags, the two setting values); none has been reviewed by a native speaker yet.

### Q333 — Search finds every setting, option and place, not only records and pages.
`feature` · 2026-11-16 · web · active
Must stay true: The ⌘K palette lists every Settings panel and row (and the named fields inside them), every Profile section and field, every keyword, the Vault's records (links, files, snippets, people) and tabs and instruments, the Job scout's pipelines, matches and saved postings and its four panels, the Statistics cards and the guide's sections — each by the same catalog key the page shows, so it is found in any of the twenty languages, plus English synonyms ("dark mode", "token"). Picking one opens the page scrolled to that row and lights it, falling back to the row's panel when the row is not drawn. `web/src/lib/search-places.ts` is the list, and a row added to Settings or Profile without a `focusId` in it fails the build.
Guarded by:
- `web/src/lib/search-places.requests.test.ts` › "gives every SettingRow in Settings and Profile a focusId"
- `web/src/lib/search-places.requests.test.ts` › "gives every titled panel in Settings and Profile a focusId"
- `web/src/lib/search-places.requests.test.ts` › "lists every focusId the Settings and Profile sources draw"
- `web/src/lib/search-places.requests.test.ts` › "names no setting or profile field the sources no longer draw"
- `web/src/lib/search-places.requests.test.ts` › "names no scout panel or statistics card the sources no longer draw"
- `web/src/lib/search-places.requests.test.ts` › "labels every place with a key that exists in the English catalogs"
- `web/src/lib/search-places.requests.test.ts` › "falls back from a row to a panel that is itself listed"
- `web/src/lib/search-places.requests.test.ts` › "is listed in the palette, with the vault and scout records"
- `web/src/lib/use-arrival-highlight.test.ts` › "waits for a late row before settling for its panel"
- `web/src/lib/use-arrival-highlight.test.ts` › "carries the id in the URL of every page that can be arrived at"
Note: Not searchable on purpose: fields inside dialogs and per-record sheets (the background entry form, the pipeline editor), the Dashboard's cards (no stable anchors — several render only when they have something to say) and the control-flow guide page's sections (English-only labels written in that page's source). The scroll-and-light was verified in headless Chrome.

### Q334 — The phone's search finds every setting and option too.
`feature` · 2026-11-16 · mobile · active
Must stay true: The phone's Search lists, beside records and screens, a "Settings and options" group and a "Sections" group read from `mobile/src/lib/search-places.ts`: every row, field and panel on Settings and Profile, every switch behind a page's ⋯ options sheet, the Job scout's three panels, the Vault's People tool and the Guide's five pages. Each is labelled by the same catalog key the screen draws, translated when drawn, and also found by its English label and English synonyms ("dark mode" finds Theme, "token" finds API key). Choosing a Settings or Profile result opens the screen with a one-shot `focus` param, scrolls that `FocusTarget` into view — measured against the scroll content — and lights it briefly, still under reduced motion; a row not drawn right now lands on its panel. A page option opens that page's options sheet; a guide page opens on that page. Every `SettingRow`, `TextField` and `Panel` on Settings and Profile carries a `focusId` (or `focusId={null}` on purpose), and the registry and the screens list the same ids.
Guarded by:
- `mobile/src/lib/search-places.requests.test.ts` › "marks every settings row, field and panel on Settings and Profile with a focus id"
- `mobile/src/lib/search-places.requests.test.ts` › "names focus ids as plain strings, or null for a row that is deliberately not a result"
- `mobile/src/lib/search-places.requests.test.ts` › "lists every focus id the screens draw, and draws every focus id it lists"
- `mobile/src/lib/search-places.requests.test.ts` › "reaches every switch behind a page options sheet"
- `mobile/src/lib/search-places.requests.test.ts` › "gives every place a label key that is in the English catalog"
- `mobile/src/lib/search-places.requests.test.ts` › "gives every place its own id and some English words to be found by"
- `mobile/src/lib/search-places.requests.test.ts` › "lands on the nearest drawn panel when the row itself is not drawn"
- `mobile/src/lib/search-places.requests.test.ts` › "lists settings and places in search, under a heading in every language"
- `mobile/src/lib/search-places.requests.test.ts` › "scrolls to the row and lights it once, then clears the param"
Note: The web half is Q333. Not searchable on purpose: fields inside per-record sheets (an application's stage change, a reminder's all-day switch) and the onboarding's reporting step, which repeats the two Crash reports switches Settings already lists. The scroll-and-light was verified by tests only; no Android emulator was attached.

### Q335 — With multiple agents, thoroughly review the full codebase, and fix what is found.
`fix` · 2026-11-17 · cross · active
Must stay true: Undoing a document delete by any route (⌘Z, either audit log, the assistant's undo, the toast) brings the file back, and nothing in the trash is deleted before the records have loaded or while a record still names it. A salary band written with one trailing multiplier ("$120-140k") reads as its low end, prefixed dollars (A$, C$…) are their own currencies, and lakh, crore and 万 are read. The assistant cannot store a match fit the store would refuse, and a run applies an approval-mode change made during it. Only one browser tab runs scheduled scout rounds, and settings changed in one tab reach the others. Going to a tab on the phone returns to the one tab navigator rather than stacking another. A dialog opened from a menu gives focus back to the menu's trigger. The web palette and the phone's search match with one accent-insensitive, word-by-word rule. The extension shipped to users does not run on localhost development ports.
Guarded by:
- `web/src/lib/vault-blobs-sweep.test.ts` › "puts back a trashed document whose record a revert brought back"
- `web/src/lib/vault-blobs-sweep.test.ts` › "touches nothing before the record store has hydrated"
- `mobile/src/lib/documents-trash.test.ts` › "deletes a copy at launch only when its record is gone"
- `service/kg/core/comp.test.ts` › "no longer ranks a $120-140k band below a $95,000 offer"
- `service/kg/core/comp.test.ts` › "refuses to rank a prefixed dollar against a bare one"
- `service/kg/tools/scout.test.ts` › "is refused at save and at update, before anything reaches the store"
- `service/kg/react/agent-runs.test.ts` › "is read from the conversation as it is now, not as it was at send"
- `web/src/lib/tab-leader.test.ts` › "lets one tab lead, and hands over when it closes"
- `mobile/src/lib/to-tab.test.ts` › "returns to the one tab navigator instead of stacking another"
- `web/src/components/common/ui-review2.requests.test.ts` › "hands focus to the menu’s trigger before the menu closes and the action runs"
- `service/kg/core/word-match.test.ts` › "ignores accents and case on both sides"
- `web/src/lib/extension-manifest.test.ts` › "ships the localhost dev ports only in a dev pack (review 2, security-1)"
Note: Ten reviewers, each followed by an adversarial verifier: 62 findings confirmed, 2 refuted, 1 uncertain (reproduced and fixed). Fixed by five agents with disjoint files. Left open: bytes orphaned on the phone by an assistant delete are not reclaimed; a document whose trash copy was purged in an earlier session cannot be brought back by an audit-log Undo; the hosted app shares its github.io origin (documented in web/extension/README.md); the phone's Today deck and long lists are not yet capped as the web's are.

### Q336 — Fix the remaining review items that can be done.
`fix` · 2026-11-17 · cross · active
Must stay true: A deleted document is kept in the trash for 30 days, so an audit-log Undo made sessions later still brings its bytes back; a phone document whose record disappears by any route (the assistant's delete, an undone upload) is set aside the same way, never twice; a restored file keeps a name that ended in " (n)". When a long conversation is trimmed, replies go before the person's own messages, and the model is told when any of those had to go. The assistant's own notes are shown in the viewer's language. The phone's Today deck reads the timeline once and stops at 20 cards, and its long lists mount 100 rows at a time while always keeping the row a search arrived at. Checked on an Android 13 emulator: the Assistant composer and sheets stay above the keyboard (Android measures in screen coordinates), a board drag held at the edge drops in the column under the finger, a row whose action is off keeps its text readable, a sheet holding typed text asks before discarding it, and dates and numbers use the same Latin digits as counts in every language.
Guarded by:
- `web/src/lib/vault-blobs-sweep.test.ts` › "brings the bytes back for an audit-log Undo made two reloads after the delete"
- `web/src/lib/vault-blobs-sweep.test.ts` › "keeps a copy whose record is gone until the window has passed"
- `mobile/src/lib/documents-trash.test.ts` › "sets aside the bytes of a record the assistant deleted, and a revert puts them back"
- `mobile/src/lib/documents-trash.test.ts` › "round-trips a name ending in " (2)""
- `service/kg/tools/tools.test.ts` › "takes the replies from the summarised part before any of the person’s turns"
- `service/kg/react/use-threads.test.ts` › "sends the model every one of the person’s turns after the cap has trimmed"
- `service/kg/react/app-note.test.ts` › "renders every fixed app note in English word for word as its producer stored it"
- `mobile/src/lib/device-check.requests.test.ts` › "pads by what the keyboard covers on screen, not 24dp less"
- `mobile/src/lib/device-check.requests.test.ts` › "names the column now under a finger held still as the board scrolls on"
- `mobile/src/lib/device-check.requests.test.ts` › "stacks the explanation over the button, so the reason under it cannot squeeze the text to nothing"
- `mobile/src/lib/device-check.requests.test.ts` › "ask before the reminder, link, person and stage sheets throw it away"
- `web/src/lib/intl-locale.requests.test.ts` › "formats Bengali dates and numbers in the digits counts use"
Note: The hosted app sharing its github.io origin needs a dedicated domain and stays open. Two app notes carry generated English inside them and are shown as stored.

### Q337 — The knowledge graph looks chaotic with a lot of data; show it a better way.
`feature` · 2026-11-17 · cross · active
Must stay true: Above a folded size of 150 records the graph opens on an overview instead of a force layout: a record with a single link is drawn as a count on the record it links to, records with no links are one "Not linked to anything" item, and records sit in labelled clusters by Role, Stage (pipeline order), Organisation (one-each group) or Keyword, laid out deterministically with no simulation. Links are drawn only for the record pointed at or selected. A focus view puts one record in the middle with its neighbours on rings, never walks through a hub two steps out (it is drawn closed with its count, and opens as a wedge capped with a "+N more" item), and keeps a trail back. Small stores keep the previous layout. The web and the phone both build these pictures from `service/kg/core/graph-view.ts`.
Guarded by:
- `service/kg/core/graph-view.test.ts` › "folds a leaf into the one record it links to"
- `service/kg/core/graph-view.test.ts` › "is the same picture every time"
- `service/kg/core/graph-view.test.ts` › "does not walk through a hub two steps out, and says what it stands for"
- `web/src/components/graph/overview.requests.test.ts` › "opens a large store on the overview and a small one on the free layout"
- `web/src/components/graph/overview.requests.test.ts` › "draws lines only for the record pointed at or selected"
- `mobile/src/lib/graph-view.requests.test.ts` › "opens a large store on the overview and a small one on the radial layout"
- `mobile/src/lib/graph-view.requests.test.ts` › "draws lines only for the selected record"
Note: Measured on a 2,700-record store: 74% of records had exactly one link, and five synthesised role nodes knotted 500 small bundles together; time to a painted graph went from 1,357 ms to about 700 ms (13,200 records: 3,919 ms to 1,239 ms). Pinch zoom on the phone was not exercised on the emulator (adb sends one finger); TalkBack was not switched on.

### Q338 — Thoroughly review the code again with multiple agents — documentation, declarations, modularity, bugs, leaks, performance, responsiveness and tests — and fix what is found.
`fix` · 2026-11-18 · cross · active
Must stay true: The web Applications board mounts a page of cards per column and keeps the open and just-moved card mounted. One finger on the phone graph at fit scrolls the page, and only a pinch claims it. A backup restore never ends with an older trash copy, and a backup taken while the documents cannot be listed refuses rather than saving none. Leaving Transfer disposes its WebGPU renderer, so visits do not accumulate render loops. A swipe on the web graph scrolls the page unless zoomed. The ledger counts only real test titles. Stored link categories, snippet tags, sources and drawers show in the viewer's language. A percentage never breaks from its % sign. A phone file record can only name a path inside the app's own document directory.
Guarded by:
- `web/src/components/common/ui-review3.requests.test.ts` › "caps each column at ROW_PAGE with a Show more at its foot"
- `mobile/src/lib/review3-mobile.requests.test.ts` › "does not stop the page scrolling until a second finger is down or the pinch starts"
- `web/src/lib/vault-blobs-races.test.ts` › "ends with the backup’s bytes, not the trash copy’s, when the delete was an earlier session’s"
- `web/src/components/transfer/DataTransferScene.requests.test.ts` › "disposes the WebGPU renderer after R3F’s own teardown, and not on a StrictMode rehearsal"
- `web/src/components/graph/overview.requests.test.ts` › "lets a swipe on the canvas scroll the page unless zoomed in, and claims a pinch itself"
- `service/test/check-requests.requests.test.ts` › "reads it, test and describe titles, with each and other modifiers between"
- `service/kg/core/domain-text.test.ts` › "says every stored link category, snippet tag, source and file drawer, and anything else as stored"
- `web/src/i18n/percent-space.test.ts` › "never breaks the line between the number and its % sign"
- `mobile/src/lib/document-path.test.ts` › "refuses the store, a sibling with the same prefix, and the directory itself"
Note: Eleven reviewers (bugs, leaks, performance, responsive/RTL/a11y, security, i18n, documentation/declarations/modularity, test coverage), each followed by an adversarial verifier: 86 findings confirmed, 2 refuted; fixed by six agents with disjoint files, plus follow-ups. Board on a 3,000-application store: 39,457 → 8,275 DOM nodes, longest load task 1.3–1.5 s → 0.3 s. "Clear every record" now says documents stay in the trash for 30 days (purging them there is left as a possible change).

### Q339 — Check every Firebase use (Crashlytics, Google Analytics, testing, App Check) is connected and working, and write a tutorial for running and connecting Ollama, vLLM, OpenAI, Claude and the rest, and MarkItDown.
`feature` · 2026-11-19 · cross · active
Must stay true: docs/MODELS.md names every provider the Provider menu offers, with its default address or key page, the reader commands the Settings card copies, and vLLM's tool-call flags. The pairing test of a hand-held, blurred, noisy code reads a burst of frames as the scanner does, so a random offer cannot fail CI one run in fifty.
Guarded by:
- `service/test/models-doc.requests.test.ts` › "names every provider in the catalogue by the label the Provider menu shows"
- `service/test/models-doc.requests.test.ts` › "gives each local provider’s default address and each cloud provider’s key page"
- `service/test/models-doc.requests.test.ts` › "carries the reader commands the Settings card copies, and its address"
- `service/test/models-doc.requests.test.ts` › "tells a vLLM user the flags without which the assistant cannot call a tool"
- `mobile/src/lib/pairing-qr.test.ts` › "reads it off-centre, blurred and noisy, as a hand-held phone sees it"
Note: Measured 2026-11-19. Web Analytics: nothing is requested before the reporting question is answered or after "off"; with consent, Firebase webConfig, installations and gtag load and two GA4 hits reach google-analytics.com with 204 (net-log; CDP shows keepalive beacons as "canceled"). Phone Analytics (API 33 emulator, debug build): collection off until consent, then app_opened and screen_viewed uploaded with 204. Phone Crashlytics: forced off in any debug build by @react-native-firebase unless firebase.json sets crashlytics_debug_enabled; on the release APK with consent, a shell-induced crash was caught and uploaded to crashlyticsreports-pa with 200. Test Lab and App Distribution steps in CI are skipped because the FIREBASE_SERVICE_ACCOUNT and FIREBASE_ANDROID_APP_ID secrets are not set. App Check is deliberately absent: it guards Firebase backends (Firestore, Functions, Storage…), and jojo has none. The pairing flake: 8 of 400 random offers lost the single degraded frame, none lost three; 0 of 1,000 lose the five-frame burst. MarkItDown (markitdown-mcp 0.0.1a4) converted a document through the dev server's /reader/mcp/ proxy.

### Q340 — Make tailoring actually correct: when jojo tailors a CV for a posting, the changes it highlights must be the changes it made.
`fix` · 2026-11-20 · cross · active
Must stay true: The marks on a tailored document are measured against the source, not taken from the model. A word the person's document does not contain is always marked, so an invented or altered claim — a changed paper title — is visible. A line that is the source word for word carries no "new" or "reworded" mark, and is underlined only when it now comes before something it used to follow. The check moves marks and never changes a character of the text. A reply in which, measured, nothing changed is refused rather than saved as a tailored document, and the card says how many of the model's marks were corrected.
Guarded by:
- `service/kg/core/mark-check.test.ts` › "unmarks lines that are the source word for word, however the model marked them"
- `service/kg/core/mark-check.test.ts` › "marks an invented claim the model presented as original"
- `service/kg/core/mark-check.test.ts` › "marks a publication title the model altered and did not mark"
- `service/kg/core/mark-check.test.ts` › "underlines a publication moved above the ones it followed, and not the ones it passed"
- `service/kg/core/mark-check.test.ts` › "does not underline a line the model claimed it moved but left in place"
- `service/kg/core/mark-check.test.ts` › "never changes a character of the text, only where the marks sit"
- `service/kg/agent/tailor-material.test.ts` › "refuses a reply whose only marks were on text it did not change"
- `service/kg/agent/tailor-material.test.ts` › "marks a change the model left unmarked, and says it did"
Note: Measured 2026-11-20 with MiniMax-M2.1 on a fictional CV read through MarkItDown and one posting, five runs: the model's marks were wrong in every run that produced a document (one run bolded 8 passages over a single one-word change; another changed a publication title from "tool-calling" to "tool-using" and did not mark it). After the check, no word absent from the CV was left unmarked in any run. One run returned an empty reply and was refused as before. Deleted passages cannot be marked; the existing "much shorter" note still covers them.

### Q341 — The mascot's waving hand looks odd: the fingers are not flat and visible, and the hand looks sideways.
`fix` · 2026-11-20 · web · active
Must stay true: When the robot waves Hi, its right hand shows its open palm to the viewer, not its thumb edge, with the fingers straightened out of their resting curl. The hand is turned about its own forearm, so it stays in the hand's place rather than tilting off it.
Guarded by:
- `web/src/lib/robot-rig.test.ts` › "waves Hi with the palm to the viewer: the hand twisted about its own forearm"
Note: Measured 2026-11-20 on frozen close-ups of the Hi pose. The old hand turn (y −0.35) was about the vertical axis, but in the model's A-pose the forearm points down and forward (wrist pivot minus elbow pivot, (−0.107, −0.304, 0.194)), so it tilted the hand and left the thumb edge to the camera. A −1.2 rad twist about that axis faces the palm out; −1.0 still shows the edge and −1.4 turns past flat. The finger chain straightens to −0.8/−0.7/−0.6; beyond that the fingers bend backwards. The broader palm reached the moves button on the outward stroke, so that stroke stops at 0.05 instead of −0.1.

### Q342 — Check that the job scout follows a board's further pages (HigherEdJobs' page list, CRA, AcademicJobsOnline and the rest), parsing each page for next-page links and crawling through them.
`fix` · 2026-11-20 · service · active
Must stay true: A board read follows the board's own next pages: a rel="next" link, a link that says Next, the numbered pages of the same listing, and a "Load more" that is a link to the same list. A "See more" that leads elsewhere on the site is not a page. Each page is vetted whole before the postings already shown are taken out, so new jobs below the first forty of a long or cumulative page are found. The address both dialogs suggest, cra.org/ads, opens CRA's job list rather than the home page it now redirects to; a search the person typed is left as typed.
Guarded by:
- `service/kg/core/board.test.ts` › "follows a Load more that is a link to the next page of the same list"
- `service/kg/core/board.test.ts` › "does not take a See more that leads to another part of the site for a page"
- `service/kg/core/board.test.ts` › "finds the new jobs on a page that repeats the ones before it"
- `service/kg/core/board.test.ts` › "opens CRA’s list, not the home page its old address now lands on"
- `service/kg/core/board.test.ts` › "leaves a search the person typed, and every other board, as it was"
- `service/kg/core/board.test.ts` › "moves it within the site the person named, so the board guard still holds"
- `service/kg/agent/queries.test.ts` › "reads CRA from the address people type: its list, then the pages behind Load more"
Note: Measured 2026-11-20 with the extension's own harvest and expandListing in Chrome for Testing, fed to crawlBoard. HigherEdJobs: page 1 offers pages 2–10 and each later page its next; 25 postings a page. AcademicJobsOnline: "next..." followed page to page, 40 a page. CRA: cra.org/ads landed on careercenter.cra.org/ with 5 featured jobs and no pager, so the scout saw 5 of 155; its list /jobs pages by a "Load more..." LINK to ?page=N, and the pages are cumulative (page 3 lists jobs 1–76), so the old 40-per-page cap before the known filter left page 3 onward with 1–2 new jobs each. After the fix: 27, 25, 27, 25, 24 new over five pages, 128 of 155. AcademicCareers: "Load more" is pressed, but on its first page the site's own request answered 200 and appended nothing for 12 s+ (headless); the same press worked twice on /jobs/?page=2. Left as is: it is the site's response, and the page as first shown is still read. A transient: one HigherEdJobs and one AJO page came back short on a 9 s wait and full on a re-read.

### Q343 — Job scout suggestions: add a search bar; move closed suggestions (not added) out of the main list into a dedicated scrollable box at the bottom, so the main list shows only active ones; and filter suggestions by tags, keywords and other categories.
`feature` · 2026-11-20 · cross · active
Must stay true: The main list shows only suggestions that still need the person: one not yet answered, or an approved job not yet added to the applications. Discarded, failed and finished ones (an approved job already in the applications, an approved record change) sit in a Closed box below it that scrolls on its own. A search box finds a card by every word typed, in any of its fields, ignoring case and accents. A filter narrows by pipeline, type (posting, match, record change), role tag, keyword and employer; values widen within a category and narrow across them, each picked value shows as a chip that turns it off, and Approve all is not offered over a filtered list. The phone has the same split, search and filters, from the same rules.
Guarded by:
- `service/kg/core/proposal-filter.test.ts` › "keeps a pending card active, and closes a discarded or failed one"
- `service/kg/core/proposal-filter.test.ts` › "keeps an approved job active until it is in the applications, then closes it"
- `service/kg/core/proposal-filter.test.ts` › "closes an approved change to a record: there is no second step after it"
- `service/kg/core/proposal-filter.test.ts` › "splits the queue in order, asking about a job only for an approved card"
- `service/kg/core/proposal-filter.test.ts` › "finds a card by any word on it, whatever the case or accents"
- `service/kg/core/proposal-filter.test.ts` › "needs every word, but in any field: a role in one place and a city in another"
- `service/kg/core/proposal-filter.test.ts` › "filters by role tag, keyword, employer, pipeline and type"
- `service/kg/core/proposal-filter.test.ts` › "widens within a category and narrows across them"
- `service/kg/core/proposal-filter.test.ts` › "keeps a picked value listed after its last card has gone, so it can be turned off"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "lists only the active suggestions in the main list, by the shared rule"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "puts the closed ones in their own scrolling box below the main list"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "has a search box and a filter for every category, over both lists"
- `web/src/components/scout/ProposalQueue.requests.test.ts` › "does not offer Approve all over a filtered list"
Note: Built 2026-11-20. "Tags" read as role tags (the top bar's role filter) and "keywords" as the person's own keywords, as the posting's background reading matched them; a card whose page has not been read carries neither and is found by search. An approved job awaiting "Add to applications" stays active on the web because that button is the step left; the phone has no such button on the card, so there an approved card is closed. Checked on the web with eight fixture cards at 1280 px (light) and 400 px (dark): search, the filter menu (scrolls inside itself), chips, and the Closed box. The phone was type-checked and linted, not run on a device.
