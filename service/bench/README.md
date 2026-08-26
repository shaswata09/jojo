# The multi-turn agentic benchmark

What it answers: **does the agent loop actually work against a small local
model, end to end, over several turns.** Not "does the model like our prompt" —
whether a real conversation leaves the store in the right state.

## Running it

Any OpenAI-compatible endpoint. vLLM, llama.cpp's server, LM Studio, Ollama's
compat port:

```sh
cd service
BENCH_URL=http://localhost:8000/v1 \
BENCH_MODEL=your-model-name \
BENCH_OUT=/tmp/bench.json \
npm run bench          # or: npx tsx bench/run.mts
```

`BENCH_ONLY` takes a comma-separated list of conversation ids or group names,
for iterating on one case without paying for sixty runs. `BENCH_TRACE=1` prints
every tool call with its arguments and the answer each turn ended on, which is
what finding anything in here actually takes — two of the fixes in this
directory's history came from reading arguments, not scores.

## Publishing a run

`npm -w @jojo/service run bench:publish -- <ISO timestamp>` folds the three
`/tmp/bench-*.json` files into `web/src/components/guide/tool-bench.json`, which
the in-app guide reads. The timestamp is an argument rather than a clock read,
for the same reason `core` has no clock: a file whose contents depend on when a
script ran is one that differs every time it is regenerated.

## What it scores, and why there are three numbers

Borrowed from τ-bench and TaskBench, which score different things and are both
right to.

**Turns.** Did each turn reach for a defensible tool? `mustCallOneOf` is a list
and usually a generous one — several turns have more than one right move, and a
benchmark that insisted on one would be measuring agreement with whoever wrote
it. `mustNotCall` fails the turn outright.

**State.** Is the store what it should be at the end? This is the axis that
catches a run which called everything the rubric asked for and still got the
wrong answer — `reschedule` failed exactly this way, with a clean turn record.

**Clean.** Both axes, for a whole conversation. The headline, and deliberately
strict: a headline that forgave a wrong final state would not be worth quoting.

## Two conditions

Every conversation runs twice: once with the whole catalog offered, once
`narrowed` to what retrieval selected. The gap between them is the price of
narrowing, and it is the number that says whether narrowing is safe to leave on
for small models — which is the configuration this app actually ships.

## The harness is on by default, because the apps pass it

The loop takes four things from whoever calls it — a declared context window, an
LLM tool chooser, a conversation summariser, and somewhere to report a
compaction — and `Assistant.tsx` and `AssistantScreen.tsx` both pass all four on
every turn.

This used to be opt-in, on the reasoning that the published numbers should
measure the model rather than the scaffolding around it. That was wrong: it made
every published figure describe a configuration the product does not ship. It is
on by default now, with `BENCH_WINDOW` defaulting to **32768** — what both local
providers declare as `defaultContext`, which is the window a person running
Ollama or llama.cpp actually gets.

`BENCH_HARNESS=0` turns it off, for isolating the model from the scaffolding
deliberately rather than by accident.

Run 16k as well as 32k. They say different things: at 32k the catalog fits and
Gemma scores 30/30 either way, while at 16k it does not fit, `full` drops to
28/30, and `narrowed` stays at 30/30 — which is the retriever earning its place
rather than a claim about it.

Read the two side by side rather than either alone. The first time it was run
the chooser looked like a large win on size and cost five conversations: it
picked `vault.file.add` and not `vault.file.update` for "file this CV under that
application", and the model, offered `add` and not `update`, created a second
CV. **Omitting the right tool does not make a model ask. It makes it reach for
the nearest wrong one.**

That is the whole reason this switch exists. A harness change that halves the
context is not an improvement until the correctness axis says so.

## What the numbers do NOT include: the approval gate

The runner passes no `approve` callback, so every call the model makes runs.
That is deliberate — the point is to measure what the MODEL does — but it is
more permissive than the app a person actually uses, and the gap matters most on
exactly the worst result in the suite.

`useAgent` sets `gate: thread.autoApprove === true ? 'destructive' : 'writes'`.
So by default every write is put in front of the person before it happens; only
someone who has turned auto-approve on for a conversation is running anything
like the configuration measured here.

The case to read this way: told to "close the UT one" with two UT applications
in the store, GPT-OSS 120B picked one and advanced its stage — closing a live
application on a guess. Ungated, that is a silent wrong write. In the shipped
default it is a card asking "close this one?" with the record named on it.
Gemma 3 31B does not do it at all; the system prompt tells the model to name
both and ask, and the two models differ in whether they listen. Both facts are
worth having, and neither is visible without running this.

## One model's number carries real variance

Gemma 3 31B and GPT-OSS 120B score the same across reruns. **Qwen3 14B does
not.** Five conversations that failed one run were re-run immediately against
identical code at temperature 0, and three of them passed. Its failures also
differ between the two conditions in both directions, which is the shape of
noise rather than of a narrowing cost.

So read Qwen's figure as a band, not a point. Temperature 0 is not determinism
on a batching server — the same prompt can take a different path depending on
what else was in the batch — and the smallest model sits closest to the
decisions that flip. If a change moves Qwen by two or three conversations, that
is inside the noise; measure it again before believing it.

The systematic failures are still worth reading, and they are the ones that
repeat: `ut-ambiguous` failed three times out of three before the search fix,
which is what made it a finding rather than a bad run.

## The thing to be careful about

Roughly two thirds of the state checks are **damage-guards**: `absent`, and
`count` at the world's own starting shape. Measured: 21 of 53 fail on a world
nothing has acted on, so the other 32 pass for a model that does nothing. They pass when nothing bad happened,
which means they also pass for a model that does nothing at all. That is not a
flaw — they are what catches an invented record — but it does mean the state
number alone reads better than the agent deserves.

`bench/discriminates.mts` prints the split: it scores the rubric against a world
nothing has acted on, so whatever passes there is a guard rather than a
requirement. `bench-fixtures.test.ts` keeps a floor on the requirement side, so
the suite cannot quietly drift into being all guards as conversations are added.
It has already caught one: `file-under-application` was scored so that a model
which read nothing and wrote nothing passed its entire state axis.
