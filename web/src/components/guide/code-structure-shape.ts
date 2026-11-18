/**
 * The measurements `CodeStructure.tsx` prints, apart from it so that file
 * exports its component only, which is what lets a fast refresh keep its state.
 * `code-structure.test.ts` re-measures them.
 */

/**
 * Measured, not remembered.
 *
 * Counts include each directory's own tests, because they are files someone
 * changing that directory will open. `src/components` moves whenever anything
 * ships, which is exactly why the command is printed underneath.
 *
 * The five `web/` rows are also re-measured by `code-structure.test.ts`, so a
 * directory that grows and a table that does not is now a failing build rather
 * than a page quietly telling a reader something that was true in August. That
 * test cannot reach the `service/` rows: `import.meta.glob` is rooted at this
 * app, and `tsconfig.app.json` grants `vite/client` and not `node:fs`, so those
 * seven stay hand-maintained and stay the ones to distrust — and they had, by
 * 2026-08: `service/kg/core` was printing half its real size, and there was no
 * `service/kg/agent` row at all, which made the half of the codebase that runs
 * the assistant and the pipelines invisible on the page that claims to show the
 * shape of it. Re-measured here. Exported for the test — the page is the only
 * other reader.
 */
export type DirRow = { dir: string; files: number; tests: number; lines: number; what: string }

export const SHAPE: DirRow[] = [
  {
    dir: 'service/kg/core',
    // Back to 120/58 with `core/status.ts` and its test — the research-preview
    // notice the two apps and the two guards all read from. The previous note
    // here explained 118/57: `core/folder.ts` and its test had been deleted,
    // 555 lines of File System Access folder rules for a folder the OS no
    // longer owns. Both movements are real; the count is simply current again.
    // `background-form.ts` and its test: the entry form's three decisions —
    // what a blank box means, what changed, what to refuse — shared by both apps.
    // `fit-reading.ts` and its test: what a stored posting reading means — read,
    // cleared, or never taken — out of the two panels that each decided it.
    // `marks.ts` and `tailoring.ts`, each with a test: the four marks a
    // tailored snippet carries, and which documents the tailoring card offers.
    // `jobs.ts` and its test: what state a piece of background work is in, and
    // what may start next — the queue behind every agent job.
    // `stage-dates.ts` and its test: when an application entered each stage,
    // where each of those dates is kept, and why one of them is kept elsewhere.
    // `ink.ts` and its test: turning one colour a person picked off the
    // spectrum into a chip that can be read, in either theme — the maths the
    // eight named colours never needed because they were measured by hand.
    // `referee-brief.ts` and its test: what a recommender is asked to highlight
    // for each application, and the one rule for when a brief counts as empty.
    // `backup-stream.ts` and its test: the backup written and read in pieces,
    // because a 500 MB store is more base64 than one string can hold.
    // `locale.ts` and `locale-catalog.ts`, each with a test: which languages
    // both apps offer and which one a device gets, and the rule that holds
    // every translation catalog to English's keys and placeholders.
    // Five fewer with jojo's own animated pairing code gone (Q329): `pulse.ts`,
    // `pulse-read.ts` and their three tests. The computer shows a QR code now.
    // Four more on 2026-11-16 (i18n): `domain-text.ts` and `advice-text.ts`
    // with a test each — the model's own words in any language, the translator
    // passed in, the English held to core's word for word.
    files: 198,
    tests: 83,
    // No new file: `postingIdentity` moved into `core/capture.ts` from
    // `core/duplicates.ts`, where it had been one of three answers to "is this
    // the same posting" — the other two are now callers, and the tests for the
    // rule came with it.
    // Re-measured 2026-10-22 with `backup-stream.ts`, and 2026-11-16 without
    // the pulse code.
    lines: 49009,
    what: 'model, ids, schema, algebra, dates',
  },
  { dir: 'service/kg/repo', files: 17, tests: 8, lines: 8461, what: 'transactions, journal, boot' },
  {
    dir: 'service/kg/tools',
    // `fit.ts` and `fit.test.ts`: keeping what a model read off a posting, and
    // clearing it — the two halves of a reading that survives a reload.
    // `tailor.ts` and its test: the one write behind the tailoring card.
    files: 43,
    tests: 15,
    // Re-measured when the two proposal verbs got an `available` gate, so a
    // suggestion already answered stops being offered as one — and again when
    // `vault.ts` grew the two verbs that name one person on one job.
    lines: 14271,
    what: '95 named operations, 85 of them writes',
  },
  {
    dir: 'service/kg/agent',
    // Re-measured 2026-09-02, when the harness grew its weak-model layer:
    // `repair.ts` (schema-driven argument repair), `stuck.ts` (repeat, failing,
    // cycle, echo and chant detection) and `verify-gate.ts` (the pre-exit
    // check), with a test file each. Six files and about 5,500 lines.
    // `fit-fixtures.ts` and its guard: a second invented person and three
    // postings, so the chain can be measured end to end against real models.
    // `judge-duplicate.ts` and its guard: the model decides whether two records
    // are one vacancy, shown only the same employer's records.
    // `tailor-material.ts` and its test: the prompt that rewrites a document
    // for one posting, and the reader that keeps, doubts or refuses the reply.
    // `focus.ts` and its test: the one line that tells the model which
    // application a conversation is about, so "this one" has a referent.
    // `record-query.ts` and its test: filter, sort, group and add up over a
    // record's stored and derived fields, for `memory.list`.
    files: 105,
    tests: 41,
    // Re-measured when the phone got a reader of its own: `documents.ts` turns
    // DOCX, ODF, decks, saved pages and RTF into text as pure functions, so a
    // handset — which has no Python and cannot install an extension — reads
    // most documents with nothing configured. PDF still goes to MarkItDown.
    // Previously re-measured 2026-09-05, when compaction was rebuilt: `budget.ts` evicts
    // in three stages and keeps the person's turns verbatim, `compact.ts`
    // writes a structured summary with a harness-built ledger of record ids,
    // and the endurance guard follows the app's history shape. No new files;
    // about 4,200 lines, most of them the tests that pin each measure.
    // Re-measured when `read-posting.ts` learnt to offer the person's own
    // keywords to the model and match the reply back onto the ones that exist.
    // Re-measured 2026-10-22, when `memory.list` became a query tool:
    // `record-query.ts` and its test, and the window-sized result cap.
    lines: 47591,
    what: 'the loop, the catalog, 10 reads, the pipelines, the weak-model guards',
  },
  {
    dir: 'service/kg/storage',
    files: 13,
    tests: 4,
    lines: 3118,
    what: 'the port, and no platform',
  },
  {
    dir: 'service/kg/react',
    // 42 with `use-tool-host.ts`: the host the assistant and the MCP link both
    // run tools against, so a capability added to one cannot be missing from
    // the other.
    // `use-duplicate-check.ts`: arithmetic first, the model second, at Save.
    // `use-applications.test.ts`: the create/update mappings held to the whole
    // record, after `postingId` was dropped on its way to the store.
    // `use-fit.ts`: the fit panel's state machine, which was 127 byte-identical
    // lines in each app with nothing comparing them.
    // `use-tailor.ts` and `use-tailoring.ts`: the run and the card behind
    // "Tailored materials", shared by both apps for the same reason.
    // `jobs.ts`, its test, `jobs-context.ts` and `jobs-provider.tsx`: the
    // registry above the router that makes a job outlive the screen that
    // asked for it — `agent-runs.ts`'s argument, generalised.
    files: 66,
    tests: 23,
    // Re-measured 2026-09-05: `historyFor` replays the covered user turns
    // ahead of the tail so a compaction never loses what the person said,
    // and `agent-runs` forwards the stored summary and the thread id.
    lines: 14559,
    what: 'providers and hooks',
  },
  { dir: 'service/kg/log.ts', files: 1, tests: 0, lines: 48, what: 'the console is the telemetry' },
  {
    dir: 'web/src/kg/storage',
    files: 12,
    tests: 4,
    lines: 3207,
    what: 'the IndexedDB adapter and the documents store',
  },
  {
    dir: 'web/src/components',
    // Re-measured when `common/CopyButton.tsx` was added, so the setup
    // commands in Settings could be copied rather than retyped; 285 with
    // `settings/McpLinkPanel.tsx`, the switch and two commands for Claude Code;
    // 286 with `ui/dialog-width.ts`, the one width every content modal takes.
    // Re-measured 2026-09-12, having drifted past the 3% the test allows; 287
    // with `vault/FilePreviewDialog.tsx`, a filed document opening over the
    // application it is filed under rather than in the Vault.
    // `common/Marked.tsx` and `detail/TailoredPanel.tsx`: the marks drawn, and
    // the card that lists what a model tailored for one posting.
    // `vault/SnippetPreviewDialog.tsx`: the words behind that card's Preview.
    // `detail/StageDatesPanel.tsx`: when the record reached each stage, and the
    // six inputs that correct a stamp the board got wrong.
    // The PDF editor added ten: the three operation panels, the page view and
    // its thumbnail, the source picker, the shared save bar, the shell, the
    // storage hook, and the Tools tab that now picks between two instruments.
    // Then the merge row with its grip, the drop hook, and the Files list's
    // "Unfiled" chip beside the filter composition it reads — with a test on
    // `empty-state.tsx`, which four tools share and which grew a rung.
    // `vault/RefereePackDialog.tsx`: a referee's applications, with what each
    // letter should highlight, downloaded as a sheet and their materials.
    // `detail/PeoplePanel.tsx`: who is on an application, as recommender or
    // point of contact, added and changed from the application itself.
    // The chat dock: `chat-dock/ChatDock.tsx` and `ChatWindow.tsx`, and the two
    // pieces it shares with the Assistant page, `assistant/Transcript.tsx` and
    // `assistant/Composer.tsx`.
    // 323 with the Guide's Control flow graph page: `guide/GuideControlFlow.tsx`, the map it draws
    // (`guide/flow-map.ts`, with a test that every path it names exists) and
    // `diagrams/StackDiagram.tsx`.
    // `transfer/PairingQrCard.tsx`: the pairing key as a QR code (Q329), in
    // place of `PulseOverlay.tsx` and `pulse-paint.ts` and its test.
    files: 522,
    tests: 148,
    lines: 77198,
    what: 'every surface you can see',
  },
  // Shorter since the Assistant's transcript, composer and wiring moved into
  // shared pieces the chat dock draws too. Longer again (2026-11-16) with the
  // pages' text moved into translation catalogs behind `useTranslation`.
  { dir: 'web/src/routes', files: 26, tests: 11, lines: 4230, what: 'fifteen pages' },
  {
    dir: 'web/src/lib',
    // Re-measured 2026-09-11: `capture-page.test.ts`, the extension opening a
    // pasted link; then the MCP link — `mcp-link.ts`, its provider, and the
    // bridge and joined-path tests that pin the two ends together; and
    // `capture-save.test.ts` beside `capture-page` and `capture-shrink`.
    // And `link-params.ts` with `check-outside-router.test.ts`: the router hooks
    // moved out of `links.ts`, so a dialog can import a path without the router.
    // Then `file-capture.test.ts`: which application a captured page is filed
    // under, after one saved posting turned up against two of them.
    // `file-input.ts`: the files are taken off a picker before it is cleared —
    // the list is live, and the Profile page had cleared first for as long as
    // it existed.
    // And `read-here.ts`: a saved page is read in this tab, never sent to a
    // reader that refuses the extension's captures as too large.
    // `duplicate-agent.ts`: the check, wired to this app's transport.
    // `tailor-agent.ts`: the seam that streams a tailored document, and
    // `jobs.tsx`: the queue wired to this app's clock, cancel and toast.
    // `mascot-cues.ts` with its test: which gesture the robot plays when an
    // application moves up a board column, and which moves draw none.
    // Then `pdf/`: the PDF editor's operations — page ranges, the page plan,
    // the two coordinate systems, the annotation model, output naming, and the
    // `pdf-lib` write path, which is tested against real documents because the
    // library needs no browser. Then the two the drop brought: what a
    // dragged-in file actually is, and how far one arrow press moves a row that
    // has been picked up.
    // 154 with `rich-text.ts` deleted: it flattened a body's formatting away on
    // save, and every editor reads spans now, so the module had no callers and
    // no reason to be findable. 156 with `document-archive.ts` and its test:
    // every stored document packed into one ZIP, the names inside it made safe
    // and unique so two `CV.pdf`s cannot overwrite each other.
    // 161 with the recommender list: `spreadsheet.ts` (a table to XLSX or CSV,
    // links clickable and formulas defused), `referee-pack.ts` (the rows and
    // folders a referee is sent), each with a test, and `save-file.ts`.
    // 165 with the chat dock: `chat-dock.ts` and its test (windows, layout,
    // persistence), `use-conversation.ts` (one conversation's wiring, shared
    // with the Assistant) and `sheet-presence.ts` (where the open record is).
    // 175 with `scout-reading.tsx`: each suggested posting read while it waits
    // for an answer, so the card shows the employer, role and place, and
    // approving does not open the page a second time.
    // `pairing-qr.ts` and its test: the pairing offer laid out as a QR code.
    // 217 with `search-places.ts` — every setting, profile field and place the
    // search palette can reach — its completeness guard, and the arrival test.
    files: 229,
    tests: 108,
    lines: 40769,
    what: 'web-only adapters and URL state',
  },
  {
    dir: 'service/data',
    files: 9,
    tests: 2,
    lines: 1625,
    what: 'demo fixtures, below the model',
  },
  {
    dir: 'web/src/data',
    files: 8,
    tests: 0,
    lines: 163,
    // Not purely façades any more, and the row above shrank by the same
    // change: `STAGE_DOT` and the `dot` field on `STAGES` moved here out of
    // `@jojo/service/data`, because their values are Tailwind class names and
    // that package is compiled into React Native unchanged.
    what: 'façades over the row above, plus the web-only stage colours',
  },
]

/**
 * How many test files this app holds.
 *
 * Named and exported for the same reason as `SHAPE`: the sentence under the
 * heading below splits the suite across three workspaces, and exactly one of
 * the three can be counted from inside it.
 */
export const WEB_TEST_FILES = 280
