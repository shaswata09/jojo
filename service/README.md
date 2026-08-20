# `@jojo/service`

The shared layer: the knowledge graph, its tools, and the React binding. Imported by
`web` and `mobile`, owned by neither.

This file exists because the package had no prose entry point — a hundred-odd files
imported from ~350 sites across two apps, whose only assembled description of the
contract was
`docs/KG-ARCHITECTURE.md` §3 — which has drifted in every layer it declares, is not
marked historical, and will therefore be read as live. **Where this file and §3
disagree, neither is the authority: the source is.** Nothing below restates a
signature, for exactly that reason. It says what each piece is for and which file to
open.

## Why it is arranged this way

> Make sure the code follows MVC design, so that UI code is only application specific
> and the model is platform specific, but the view layer is platform and UI
> independent — because we will have web (React), mobile (React Native), and native
> (Electron), and we want to reuse the full service layer across platforms.

Two consequences that are worth knowing before reading any file:

- **L0–L3 (`core`, `storage`, `repo`, `tools`) name no platform at all.** They run
  headless in Node with no DOM shim. That is enforced, not aspirational — see
  _The guards_ below.
- **L4 (`react`) is platform-free but not framework-free.** It renders nothing and
  names no DOM type, so React Native and a browser both run it unchanged. A non-React
  shell would reuse L0–L3 and rewrite L4. That is the deliberate trade: the shared
  layer is _L0–L3 for anyone, L4 for React_.

## The layers, and the import direction

Each layer may import the ones above it and never the ones below.

| Subpath                   | What it is                                                                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `@jojo/service/core/*`    | L1. The domain model, the snapshot and its indexes, validation, projection, dates, statistics. No I/O, no clock, no React. |
| `@jojo/service/storage/*` | L0/L2. The `Driver` port, its conformance suite, the in-memory driver, schema and migrations.                              |
| `@jojo/service/repo/*`    | L2. `boot`, the repository, the journal, the write queue, the seed. Durability lives here.                                 |
| `@jojo/service/tools/*`   | L3. Every write the app can make, as 62 named, undoable, schema-checked operations.                                        |
| `@jojo/service/react/*`   | L4. Providers and hooks over the repository. Two `.tsx` files, both providers.                                             |
| `@jojo/service/data/*`    | The demo fixtures. Read by `repo/seed.ts` and by `tools/memory.ts`.                                                        |
| `@jojo/service/log`       | Logging.                                                                                                                   |

`package.json`'s `//exports` block explains why the map is hand-maintained, why every
target names its extension, why there are no barrels, and why there is no `conditions`
object. All four cost a probe to find; read it before editing the map.

**There is no build step and no `main`.** Both apps compile this TypeScript themselves.
`npm -w @jojo/service exec tsc -b` is the authority on whether it type-checks — the
apps' own programs pull the source in under their own `lib` and `types` settings, so
that pass is incidental and must not be treated as the check.

## The ports — what a new platform has to write

A port is where the platform plugs in. There are four, and they are not in the same
state as one another, which is worth saying plainly.

- **`Driver`** — `storage/driver.ts`. Durable rows in, durable rows out. Three
  implementations exist (IndexedDB in `web/src/kg/storage`, AsyncStorage in
  `mobile/src/kg/storage`, in-memory here), and nothing in its shape encodes a
  browser. **A new one must call `describeDriverConformance(subject)` from
  `storage/driver-conformance.ts`** — that suite is the contract, and both apps run
  it. This is the port to copy the style of.
- **`Host`** — `react/host.ts`. Undo requests, suspend, resume: the things the
  platform tells the app rather than the app asking. Members are named for intent
  (`onUndoRequest`, not `onShortcut`), and `onResume` is optional with the reason
  written down.
- **`ToastContextValue`** — `react/toast.ts`. Carries no toast list, deliberately.
  One wart: `ToastAction.onClick` is DOM vocabulary in a platform-free file, and the
  React Native adapter pays for it with a documented bridging shim.
- **`FileStore`** — `storage/file-store.ts`. **Zero implementations. Neither app
  imports it, and neither app imports `core/folder.ts`, which is built on it.** The
  shape is careful and the conformance suite is written, but a conformance suite that
  only ever runs against the in-memory stand-in proves the stand-in satisfies the
  port and nothing else. `host.ts` states the rule this is on the wrong side of: a
  port whose second implementation is hypothetical is a port designed against a
  guess. Treat it as a proposal, not as settled surface.

## Writes go through tools

Nothing outside `tools/` mutates the graph. A tool is `defineTool({ name, input,
run, describe, … })` in `tools/tool.ts`; the registry is the const object in
`tools/index.ts`; `tools/runtime.ts` runs one inside a transaction, commits one
journal entry with before-images, and hands back an announcement and an undo.

Two rules that are easy to break and are guarded:

- **Time enters through `ctx.now`.** No module under `kg/` may read a clock (D26).
  A tool that stamps its own timestamp breaks journal replay.
- **A tool added to the registry must be exercised by a test.**
  `test/coverage.test.ts` reads the registry rather than a maintained list and fails
  if any tool is run by nothing. It matches on invocation shape, not on the name
  appearing in quotes somewhere — a journal fixture carries `tool: 'x'` as a label,
  and that spelling once made `profile.set` look covered while nothing ever called it.

## The guards

`npm -w @jojo/service run lint` runs oxlint and three scripts. **Both apps run them
too**, so a violation in mobile's tree fails web's lint.

- `scripts/check-layers.mjs` — the import direction above, plus what an app's adapter
  may reach (`storage/*` and `log`, nothing else).
- `scripts/check-platform.mjs` — parses each file and bans the wrong platform's
  globals and modules per layer, plus wall-clock reads. It exists _in addition to_
  the `tsconfig` `lib` restriction because `@types/react` declares `HTMLElement` and
  ~150 other DOM names as empty interfaces for React Native's benefit, so the type
  system alone lets a bare annotation through.
- `scripts/check-no-copies.mjs` — one copy of the layer, reached through the exports
  map. Written after `mobile/src/kg` spent four months as a `cp -R` of `web/src/kg`
  that drifted 813 lines with nothing able to see it.

All three discover the apps from the workspace list in the root `package.json`. They
used to name `web` and `mobile` as literals, which meant a third app would have been
governed by none of them while all three still printed green — measured, and the
reason the discovery is there.

## Tests

`npm -w @jojo/service run test`. The suite runs in **node**, not jsdom, and mounts no
components (D20): the binding layer is thin by construction, and testing React's
`useMemo` is testing React. Where a decision lives inside a hook, the rule is pulled
out into a function over its collaborators so it can be asserted against a repository
built from the memory driver — `undoableWith` and `undoableSaying` in `react/undo.ts`
and `runWithToast` in `react/use-tool.ts` are the worked examples, and each of their
headers says why.

## Where to look for _why_

- `docs/KG-ARCHITECTURE.md` — 27 numbered decisions with their reasons. The best
  artefact in the repo for why anything is the way it is. **§3 "Public API" has
  drifted** (see the top of this file); §1 and §5 are accurate.
- `docs/SERVICE-LAYER.md` — the migration log, written as it happened. §8.3
  falsifies `check-no-copies` against the real historical fork and §8.6 lists what is
  _not_ guarded. Step-ordered, so read it for a specific question, not front to back.
- The per-file headers. They are the strongest documentation here by a distance, and
  several record the file's own earlier reasoning as wrong — `tools/scout.ts` names
  both versions of a justification that has been wrong twice. Trust them over any
  summary, including this one.
