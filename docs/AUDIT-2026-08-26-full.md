# Merged audit — 47 findings, ranked by user harm

53 verified findings in; 4 merged pairs, 1 dropped, 1 folded. Ranking is by what it costs a person whose only copy of their job search lives in this app: irreversible loss and exfiltration first, then work that silently goes wrong, then everything else.

**Dropped:** `web/extension/manifest.json:38` (localhost:5173 in `matches`) — the verifier dismantled both attack legs itself: unreachable on a packed install because nothing listens on the port, and no escalation on a dev machine because a malicious dev-dependency already has code execution as the user. The residual requires a benign local server that reflects attacker content *plus* a top-level navigation lure.

**Folded:** `loop.ts:1053` (`auto` waives approval for `memory.clear`/`memory.reset`) into #1 — same two tools, same gate, same false promise in `GuideTools.tsx:82`. The verifier reduced it to a copy fix on its own ("that is consent, not a breach").

---

## Tier 1 — Irreversible loss, or data leaving the device

**1. `service/kg/agent/loop.ts:593`** (with `:994`, `:1053`)
`const enforced = options.tools !== undefined` is false for the Assistant, so the retriever's strip of `memory.clear`/`memory.reset` is advisory and the executor runs any catalog name; under `auto` the approval gate is off too.
Every record is wiped, `undoable: false` so nothing is journalled, no undo, no confirmation — reachable from 2 of 3 approval modes and from injected text in a captured posting.
Make the refusal at `:994` apply to `NEVER_IMPLICIT` names regardless of `enforced`, and exempt the two `effect: 'admin'` tools from the `mode === 'none'` waiver.

**2. `web/extension/background.js:568`**
`html = html.split(key).join(value)` splices fetched stylesheet text in unescaped; `</style><img src=https://…>` (unquoted) evades both the name-based sweep at `:582` and all three `remoteRefCount` patterns, which require a quoted value.
A stored capture beacons the attacker on every viewing — the invariant `capture.ts:44` calls the last line of defence — and an exported capture opened outside the sandbox executes injected script.
Escape `<`/`>`/`"` in the fetched CSS before splicing (or serialise the token as a CDATA-safe payload), and extend `REMOTE_REF` to unquoted attribute values.

**3. `web/extension/serialise.js:206`** (and `mobile/src/lib/capture-script.ts:215`)
`doc.querySelectorAll('*')` never matches `doc` itself, so the root `<html>` element's attributes skip every strip and rewrite pass.
A CSSOM-set `documentElement.style.backgroundImage` serialises with `&quot;`, matches none of the three scan patterns, and is *accepted* into the archive as a live CDN address — same beacon as #2, via a different hole.
Walk `[doc, ...doc.querySelectorAll('*')]` in both serialisers.

**4. `mobile/src/components/transfer/ReceivePanel.tsx:258`**
`onClose` resets `applying.current = false` while `convoy.progress().complete` stays latched true forever, so the 250 ms poll re-enters and re-opens the sheet — and `ConfirmSheet.tsx:42` calls `onClose()` *before* `onConfirm()`.
"Replace everything on this phone?" cannot be dismissed, and a second tap starts a concurrent `applyPlan`/`repo.replaceAll` over the store the first one is mid-write on.
Move the `applying` reset to the top of the effect keyed on `session`, not into `onClose`.

**5. `service/kg/repo/repository.ts:582`**
`onRemoteCommit` does `await repo.flush()` then `rehydrate()` with no health check; an `off` queue answers `'stranded'` instantly without draining, and `snapshot.reset` replaces the graph with disk contents.
Another tab's commit wipes every unsaved edit off the screen — permanently, since `off` never clears in-session — and `clearHistory()` destroys the undo and audit trail that would have shown what was lost, including the export the stall banner tells the user to take.
Copy the guard the resume path already has 70 lines away: `if (repo.health.state === 'degraded' || repo.health.state === 'off') return`.

**6. `service/kg/repo/repository.ts:473`**
`replaceAll` flushes the queue before wiping, but `commit` is synchronous and unguarded, so a background commit landing during the `await driver.replace(...)` enqueues into a now-idle queue and drains independently.
A store the user just emptied keeps a resurrected record, a journal row for a graph that no longer contains it, and its pre-replace `dataSet`/`seededAt` — `replaceAll` still returns `ok`; reproduced against the real repository.
Hold a lock (or a generation counter) across the replace and reject/defer commits that arrive inside it.

**7. `mobile/src/screens/SettingsScreen.tsx:242`**
`Clipboard.setString(exportJSON())` then an unconditional "Copied to the clipboard" toast; the Android module swallows `TransactionTooLargeException` above ~1 MB in a `catch { printStackTrace }`.
This is the phone's only backup route (import is blocked, transfer is a demo), the store is deliberately provisioned to 50 MB, and "Clear every record" tells the user to export first — a straight path to total loss on a false success message.
Size-check before `setString` and refuse above the Binder limit, or read back via `getString()` before claiming success.

**8. `service/kg/core/ontology.ts:268`**
`.replace(/[^a-z0-9 ]+/gu, ' ')` after a diacritics-only `fold`, so any CJK/Cyrillic/Greek/Hebrew predicate normalises to `''` and `checkClaim` returns `'A relation needs a name.'`
A Chinese or Russian CV populates the entries and loses **every** relation — and `ProfileUpdateOffer.tsx:238` only counts `out.ok`, so the toast still reports success. Silent, total loss of the relation layer for entire scripts, against the module's own "nothing is ever dropped" contract.
Fold non-Latin scripts to a stable transliteration or keep the surface as the id when normalisation empties it.

**9. `service/kg/agent/loop.ts:889` + `service/kg/react/agent-runs.ts:428`** *(merged: one defect, found from agent-loop and react-hooks)*
`counter` restarts at 0 each `runAgent`, so turn 2's first step arrives as entry id `s-s1`, which `record()` upserts *in place* over turn 1's step.
Turn 1's tool row is destroyed and turn 2's is filed under turn 1's question, then persisted via `assistant.thread.set` (`undoable: false`); `toTranscript` replays a tool call the model never made, and the earlier write loses its undo affordance.
Mint step entry ids through `nextId()` (or prefix with the run id) instead of the per-run counter.

**10. `service/kg/repo/journal.ts:175` + `service/kg/tools/vault.ts:58`** *(merged: root cause + call site)*
`withoutStamp` deletes only `updatedAt`, and edges stamp `createdAt`; `fileUnder` unlinks-then-relinks unconditionally, so the overlay hides the staged removal and `tx.link`'s idempotence guard cannot fire.
A Save with nothing changed pushes an entry onto the undo ring and calls `redo.clear()` — one ⌘Z silently undoes nothing, and any pending redo is gone. Same shape in `timeline.ts:88` and `assistant.ts:158`.
Strip `createdAt` in `withoutStamp` too, and make `fileUnder` differential like `keyword.record.set` (unlink only what is no longer wanted).

---

## Tier 2 — Wrong behaviour a user will hit and act on

**11. `web/src/lib/llm.ts:267`** (and `:351`, `:385`)
`assembled` has no `usage` field, so the streamed `done` event's usage is dropped; `done.usage === null` is false at runtime for `undefined`, and `JSON.stringify` removes the key.
`guardTruncation` never runs on any web-streamed turn, so a local server that silently dropped the tool list and the question answers anyway and jojo shows it as an ordinary reply — the exact case `stream_options: {include_usage:true}` was added for.
Add `usage: StreamUsage | null` to `assembled` and write `usage: event.usage` in both drains.

**12. `mobile/src/lib/handoff-server.ts:108`** (and `:121`, `:127`)
`Buffer` is a free identifier; Hermes has no `Buffer` global and nothing in `index.ts`, `polyfills.ts`, `metro.config.js` or any dependency installs one.
Every handoff response throws `ReferenceError`, no bytes are written, and the phone sits on "Paired. This phone is listening…" at 0 bytes — the entire receive half of Transfer is dead on a real device. It typechecks only because `@types/node` is hoisted and `check-platform.mjs` never scans `mobile/src/lib`.
Drop the wrapper — `socket.write(writeResponse(...))` accepts a `Uint8Array` — and add `mobile/src` to the platform check's roots.

**13. `service/kg/core/model-server.ts:567`**
`ollamaChatRequest` posts the OpenAI-shaped history verbatim, so assistant `tool_calls[].function.arguments` goes back as a JSON **string** into a field Ollama decodes only as an object.
The follow-up request after the *first* tool call is rejected 400, so the agent can never complete a tool call on provider `ollama` at all.
Convert `raw` back to an object for the ollama dialect, mirroring `anthropic.ts:181`.

**14. `mobile/src/screens/applications/Board.tsx:173`**
`.onEnd(() => …)` discards RNGH's `success` argument, and RNGH fires `onEnd(event, false)` on `CANCELLED`/`FAILED` once the gesture was ACTIVE.
An incoming call or rotation mid-drag commits a stage change the user never dropped; the 8 s undo toast routinely expires during the interruption, so the wrong stage persists silently.
Gate only the `onMoveStage` call on `success`; leave the teardown (`setDragging`/`setHover`/`onDragChange`) in `onFinalize` or it will strand `held.current`.

**15. `mobile/src/lib/today.ts:56`**
`export const TODAY = dayOf(now())` is evaluated once at import, with a comment reasoning about browser tab reloads — but an RN process resumes the same JS context for days.
`completedOn` is stamped with a stale day (`DraftSheet.tsx:184`), and the week strip, overdue badges and "done today" tile all measure against it; the agent path reads the real day, so the two disagree inside one running app.
Read the day from the provider (`priority.ts` and `use-timeline.ts` already do), or recompute on `AppState` `'active'`.

**16. `mobile/src/lib/markitdown.ts:34`**
`uri.slice('file://'.length)` with no `decodeURIComponent`, while the picker returns percent-encoded URIs and `storedName` deliberately permits spaces.
`My CV.pdf` reports "The copy of that document is no longer on this device." to the assistant, the Fit panel and CV import — a false claim of data loss about a file `FileViewer` opens on the same screen.
Decode, as the twin at `documents.ts:113` already does and as its comment predicts.

**17. `web/src/lib/markitdown.ts:62`** (and `:181`)
`sendToReader` honours `signal` only on the direct path and drops it for the extension relay, which `readDocument` cannot accept at all; `handshake()` never passes it on either transport.
Cancelling "New application from a link" doesn't stop the read: up to 40 s later the posting is written and the full create dialog opens unprompted over whatever page the user navigated to.
Thread an `AbortSignal` through `readDocument`/`callModel` in `capture-bridge.ts`, and test `signal.aborted` at each step boundary in `posting-agent.ts`.

**18. `web/src/lib/handoff-send.ts:142`** (and `handoff-client.ts:93`)
`await build()` is unguarded and `start` is invoked as a floating promise; `backup.build` throws on quota reads and on `JSON.stringify` exceeding V8's string limit, and `arrayBuffer()` at `handoff-client.ts:93` sits outside the `try` that makes every other failure a Result.
The Send panel stays on "Gathering your records…" at 0 % with no error and no `problem` set; a dropped wifi mid-body does the same at 'sending'.
Wrap both in `try`/`catch` routed to the existing `setStage('failed')` path — `download` already does this with the identical call.

**19. `web/src/components/settings/DataPanel.tsx:67`**
`await file.text()` is not in a `try` and the caller is `void onPickBackup(...)`; `Blob.text()` rejects for a cloud-placeholder, moved, or unmounted file.
"Restore a backup" does nothing at all — no dialog, no toast — on the one screen a user reaches when something has already gone wrong. The "That file cannot be restored" toast is unreachable for this class.
Use the house idiom from `vault-blobs.ts:269`: `try`/`catch` into the existing failure toast. The Export button forty lines up already has it.

**20. `service/kg/react/use-pipelines.ts:217`**
`await runAgent({…})` has no `try`/`finally`, and the `busy.current = false` unlock sits after it (plus a second unguarded throw point at `runtime.run('pipeline.run.record')`, `:248`).
One throw jams the engine-wide lock permanently: every pipeline stops, `runNow` is dead, and the panel shows the failed pipeline as working forever. Nothing but a reload recovers it.
Add the `try`/`finally` that the sibling `runAgent` call site in `agent-runs.ts:357` documents at length.

**21. `service/kg/react/agent-runs.ts:516`**
`forget()` deletes the run without waiting for it to unwind, so a second `start` passes the `busy` guard, and the first run's `finally` then clobbers it by thread key — there is no run token despite the comment at `:380` claiming one.
Reachable in two clicks on both AskBoxes (no `disabled={busy}` on "Ask something else"): `busy` flips false under a live run, `stop()` becomes a no-op, and every later entry takes id `'e0'` and overwrites the previous one.
Carry a run token into the settle path and no-op the `finally` when it doesn't match; add `disabled={busy}` to both AskBox reset buttons.

**22. `service/kg/agent/loop.ts:540`** (and `:671`)
The first `if (signal?.aborted)` check is at `:742`, inside the round loop; the chooser and summariser run before it and are built as `ask: (messages) => agentTurn(settings, messages, [])` with no signal.
Stop is ignored for two full, uncancellable, untimed round trips on a local model — composer disabled, sockets open, after the UI said it was stopping.
Check `signal?.aborted` before both calls, and add a signal parameter to `ChooserDeps`/`CompactDeps`.

**23. `service/kg/agent/loop.ts:537`**
`lexicalSet !== null` is used as "the retriever recognised something", but `offeredFor` returns null only when `carried === null` — after turn 1 it never abstains.
"yes, do that" on a small window consults the chooser anyway; reproduced losing 37 write tools including the one the conversation was about, producing the repo's own named failure: a model with no way to act reporting that it acted.
Test the lexical `select()` result directly rather than the merged `kept` set.

**24. `service/kg/react/use-threads.ts:190`**
`{ kind: e.kind, text: e.text }` rebuilds a note without `app`, which `agent-runs.ts:464` deliberately records and `model.ts:1189` defends with six lines of prose.
`toTranscript`'s guard is dead for every saved conversation, so "The model stopped mid-reply…" and the trim note are replayed to the model as its own prior speech — in exactly the long conversations where the extra message also costs context.
Carry `app` in both `toThreadEntries` and `toAgentEntries`, and declare it on `AgentEntry`'s note arm so the conditional spread stops hiding it.

**25. `web/extension/background.js:476`**
The asset loop iterates a list its own body appends to (`:522`, `:544`) with no ceiling, and `byHref` de-duplicates only identical URLs; separately the `kind === 'css'` branch `continue`s at `:550` before the `CAPTURE_MAX_ASSET_BYTES` check at `:554`.
A page whose stylesheet `@import`s two fresh unique URLs per sheet makes the service worker fetch forever with the badge stuck on '…' and no recovery.
Cap `assets.length`, and length-check the CSS text before inlining it.

**26. `web/extension/background.js:247`**
`recordExtensionCrash` is called in `relay()`'s catch and defined nowhere in the repo (`git log -S` shows only the call site ever landed).
Every relay *transport* failure — the reader not being started, the commonest case — throws `ReferenceError` before the `return { ok:false, …, reason }`, so all four hand-written diagnostics are dead code and the user gets Chrome's "message channel closed" text instead.
Define it or delete the call.

**27. `service/kg/core/comp.ts:69` and `:91`** *(merged: one function, one screen)*
The `code` group only matches after the digits, so `EUR 112,500` loses its currency; and `raw.replace(/[,\s]/g,'')` doesn't strip dots, so `€112.500` parses as `112.5` — contradicting the comment directly above it.
On the offer-comparison screen the file itself calls "the highest-stakes moment in the whole product": two currencies get a green "best" mark and a mobile re-sort the header forbids, and a €112,500 offer prints as `112.5` and sorts below a €95k one.
Allow the ISO code before the digits (guarded by `CODES`), and treat a dot as a thousands separator when it is followed by exactly three digits and no other decimal marker.

**28. `web/src/components/vault/Calculator.tsx:148`**
A `window` keydown listener whose only guard is the target's tag calls `e.preventDefault()` on Enter for anything that is not an INPUT/TEXTAREA.
While `/vault?tool=tools` is open, Enter does not activate any `<a href>` — the six sidebar and three topbar links are dead to the keyboard (Space doesn't activate anchors). Escape also silently wipes the calculator whenever a dialog is dismissed.
Bail on `e.defaultPrevented`, on modifiers, and when the target is not inside the calculator — the shape `useSpotlight` already uses.

**29. `web/src/routes/Assistant.tsx:648`**
The whole transcript is one `aria-live="polite"` region, and `agent-runs.ts:446` rewrites the answer text node once per streamed delta with no batching.
A screen-reader user gets a continuous stream of overlapping partial-sentence announcements for the length of every answer, and cannot reach the interleaved tool rows.
Set `aria-busy` on the region while streaming (or announce only the settled answer in a dedicated `sr-only` node) — do **not** remove `aria-live`, which would regress the recorded mobile fix.

---

## Tier 3 — Real, small, or contained

**30. `service/kg/repo/journal.ts:112`** — `putEdge` is insert-if-absent, so a delta with both images set never updates memory while `opsFor` writes the new one to disk. Memory and disk hold different `createdAt` until the next reload; the invariant break is live even though the only divergent field is currently unread. Fix: remove-then-insert (a naive upsert would double-count `#degrees`).

**31. `service/kg/core/validate.ts:429` + `service/kg/core/schema.ts:214`** *(merged: one boundary, one fix)* — envelope `createdAt`/`updatedAt` get only a non-empty-string check while every prop timestamp goes through `s.instant`, and `s.instant` itself accepts anything `Date.parse` reads (`'5'`, `'Mar 5 2026'`). A hand-edited or damaged backup renders `undefined NaN` in the thread list and "9,240 days ago" on a card. Fix: give `instant` the round-trip strictness `isoDate` already has, and route the envelope fields through it.

**32. `service/kg/tools/runtime.ts:271`** — `describe()` runs after `execute`, so `overlay.node()` returns `undefined` for anything `tx.del` staged. All 13 delete tools fall to their generic fallback, and since `announcement.title` is the journal label, the audit log — the answer to "a record changed by itself" — renders several deletes as identical anonymous rows. Fix: snapshot the describe inputs before the transaction, or pass the pre-delete overlay.

**33. `service/kg/tools/keyword.ts:188`** — `keyword.detach` validates neither end while its sibling `attach` validates both; `tx.unlink` is a silent no-op. `ok: true` with "Keyword removed" is handed to the agent loop for a write that never existed. Fix: add the two `require` calls.

**34. `service/kg/tools/scout.ts:153`** (and `:330`) — no `available` guard and no `BECAME` check, and `BECAME` is `fromCardinality: 'one'`. A second promote (agent-reachable; both UIs gate it) creates a duplicate draft and silently moves the provenance edge to it. Fix: an `available` guard on the existing edge.

**35. `service/kg/core/model-server.ts:820`** — `readOllamaTurn` skips `cleanToolName`, which exists because a real model named a tool `memory_get<|channel|>commentary`. gpt-oss under Ollama burns a round trip on "No tool is called …". Fix: one call, plus the empty-name drop the OpenAI path has.

**36. `service/kg/core/model-stream.ts:208`** (and `:227`) — the only two unguarded property reads in an otherwise uniformly defensive loop; `JSON.parse('null')` throws out of `push()`. A `data: null` frame is caught by `sendStream` as a network failure, so a user watching half an answer is told nothing is listening — and the answer is discarded, against the loop's own "one bad chunk should cost a few tokens". Fix: object-check `frame` and each fragment.

**37. `service/kg/core/anthropic.ts:308`** — `stop_reason` is passed through unmapped, and Anthropic says `max_tokens` where consumers test `'length'`. On the one provider whose 8192-token cap jojo sets itself, a truncated reply is presented as finished. Fix: map `max_tokens` → `length`.

**38. `service/kg/core/model-server.ts:625`** — `blockedByBrowser()` sets no `why`, so the `'blocked'` failure kind is unreachable and a CORS-blocked provider is counted as `unreachable`, exactly the confusion `why` was added to remove. Fix: `why: 'blocked'` here and on `local-service.ts:104`'s non-aborted branch.

**39. `service/kg/repo/boot-ready.ts:136`** (root cause `journal.ts:241`) — `readJournalRows` drops `trimmed`, so `trimJournal`'s short-circuit never fires and the identity check is always true: every launch clears and rewrites the ops store and logs "pruned the audit log from 200 to 200 entries". The same dropped field also defeats `repository.ts:404`'s `if (fromAudit.trimmed === true)` revert guard, which matters more. Fix: carry `trimmed` in `readJournalRows`.

**40. `service/kg/agent/loop.ts:814`** — an answer containing a complete quoted tool payload is discarded and replaced with a `--jinja` server-misconfiguration error; asking about a tool is what makes the retriever offer it. Reproduced end-to-end. Fix: require the JSON to be the whole answer, not a fragment inside prose.

**41. `service/kg/react/use-pipelines.ts:248`** — `pipeline.run.record` runs unconditionally, ignoring `result.stopped`, so an aborted round is written as an idle one. Saving model settings mid-round (the effect cleanup aborts on every `llm` identity change, and `ConnectionsSection` saves per keystroke) can push a pipeline to the shutdown offer one round early and stall its schedule for a full interval. Fix: skip the record when `stopped === 'aborted'`.

**42. `mobile/src/sheets/AddFromLinkSheet.tsx:67`** — the only unguarded `void (async …)` in `mobile/src`; `writeCapture`'s three bare `fs` awaits are the one throw path under `readPosting`. On a full disk the sheet sits on "Reading…" with the button disabled and nothing said, leaving a Vault row with no bytes. Fix: the `.catch` that `FitPanel.tsx:127` already carries with this exact comment.

**43. `web/src/components/settings/DocumentsPanel.tsx:40`** — calls `navigator.storage.estimate()` raw instead of the purpose-built `estimateStorage()` that every other caller uses; rejects in an opaque origin. Same blank line either way, plus a spurious crash-log entry in exactly the environment where storage is already degraded. Fix: use the helper.

**44. `mobile/src/lib/toast.tsx:98`** — `onDismiss={() => onDismiss(t.id)}` is a fresh closure each render and is in the timer effect's dep list, under a comment claiming it is stable. Each new toast restarts every visible toast's full 8 s, keeping stale Undo buttons live. Fix: pass `onDismiss` and `id` separately, as the web sibling does.

**45. `web/extension/background.js:173`** — `READ_TIMEOUT_MS` is 120 s while `capture-bridge.ts:183` gives the same request 40 s and only CHUNK messages re-arm it (reads never stream). A 55 s PDF conversion succeeds and the user is told the extension did not answer. Fix: make the two budgets one constant, or stream reads.

**46. `web/extension/popup.js:251`** — `start()`'s three setup awaits precede every `addEventListener` and `void start()` discards the rejection; an MV3 worker wake race (which `bridge.js:226` documents as normal and handles) leaves every control unwired, "Keep this page" enabled and inert, and "Nothing kept yet" shown over queued captures. Fix: `try`/`catch` with a visible message, and attach listeners first.

**47. `service/kg/core/ics.ts:244`** (and `:277`) — interpolates `${a.org} — ${a.role}` instead of `displayName`, whose comment names this exact bug; `role` is `''` for anything promoted from a bare posting URL. The exported calendar shows "Rice — " and "Offer from Rice — ." Fix: import `displayName` from `./model`, as `stage-policy.ts` already does.

---

## What this audit did not cover

**Surfaces no area owned.**

- **Version skew.** `service/kg/storage/migrations.ts` and `web/src/kg/storage/idb-migrate.ts` produced zero findings, in an audit that repeatedly leaned on `restore.ts`'s own threat model — "written by a jojo three versions older than this one". Nobody opened an old store with a new build. For an app whose entire value is the store surviving, this is the largest single hole.
- **What leaves the device.** `secrets.ts` was never read; neither was the prompt payload. The transport area audited *how* requests are shaped, never *what is in them* — whether comp figures, CV text or whole records reach openrouter/groq/nvidia under default settings, and whether `budget.ts`/`retrieve.ts`/`compact.ts` bound that. Firebase Crashlytics landed two commits ago and nothing checked whether crash payloads or the "closed vocabulary" analytics carry record content. One privacy finding exists in the whole audit and it is about a browser extension.
- **The analysis half of the domain.** `core/` is 17,536 lines and yielded 5 findings, 3 of them in `comp.ts` and `ics.ts` — two of the smallest files. `statistics.ts`, `recommend.ts` (the Wilson-interval advice layer), `fit.ts`, `assess.ts`, `twin.ts`, `tailor.ts`, `pulse.ts`, `duplicates.ts`, `project.ts`, `stage-policy.ts`, `board.ts`, `segments.ts` produced nothing. Wrong numbers on the Statistics screen are exactly the defect class this method should be good at, and it found none.
- **The screens people actually use.** `web/src` is 58,120 lines and yielded 6 findings — four in Settings/Transfer/Vault. Applications, Dashboard, Calendar, Graph, Statistics, Profile, JobScout, Organisation: zero. `web/extension` is 2,292 lines and yielded 6. A 25× density gap is a coverage artifact, not a quality signal.
- **The hooks behind those screens.** All 5 react-hooks findings are in `agent-runs`/`use-threads`/`use-pipelines`. `use-applications`, `use-vault`, `use-timeline`, `use-keywords`, `use-scout`, `use-profile`, `use-priority` and `projections.ts` — the read/write path for every non-agent feature — were not examined.
- **Per-tool validation.** 84 effect-bearing tools (13 deletes) yielded 4 findings. One was a genuine class sweep (`describe` over the post-delete overlay); `keyword.detach`'s missing guards were found by comparing it against its neighbour, which means the other 83 tools were never given the same neighbour-comparison.

**Classes this method structurally cannot see.**

- **Nothing ran on a device or in a browser.** The verifier could not run Ollama, Hermes, or a real IndexedDB transaction; every RN and IDB finding is static reading. Both RN bugs found (`Buffer`, the re-opening sheet) were readable by eye — so native module behaviour, permission flows, background/foreground limits, WebView quirks and real transaction ordering are entirely unsampled, not clean.
- **Scale and performance.** One efficiency finding, reasoned rather than measured. The repo's own driver notes put the store at 6 MB / ~9,500 nodes; nothing checked snapshot rebuild, list rendering, boot time or memory at that size, and a job tracker's records only grow.
- **Accumulation over time.** The three findings of this shape (frozen `TODAY`, the jammed pipeline lock, the unbounded asset queue) were each visible because a constant or a missing `finally` made them legible. Leaks, ring growth and drift across days of uptime need a running process to surface.
- **Prompt and tool-description correctness.** Whether the model is *told* the right thing — tool descriptions, the system prompt, the retriever's copy — is not falsifiable by reading types, and no finding touches it.
- **Tests that pin wrong behaviour.** The gate is green, so a wrong assertion is invisible unless someone reads it. This audit caught two by accident (`loop.test.ts:1314` pinning "auto asks before nothing, deletions included"; `journal.test.ts:496` testing a path that never crosses `readJournalRows`). The class is confirmed real and only incidentally sampled.
- **Mobile accessibility.** Two a11y findings, both web. Screen-reader labels, touch-target sizes, dynamic type and focus order across 30,786 lines of React Native were not looked at.