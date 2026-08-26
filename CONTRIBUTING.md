# Contributing

Thanks for looking. This is a three-platform monorepo — a web app, an Android
and iOS app, and the shared layer both of them run on — so the most useful thing
to know up front is where your change belongs.

## Getting set up

```bash
git clone <your fork>
cd jojo
npm install          # once, at the ROOT — it is an npm workspace
cp .env.example .env # optional; everything in it is optional
```

Then, for whichever platform you are working on:

```bash
npm run dev -w web            # the web app
npm run android -w jojo-mobile
npm run ios -w jojo-mobile
```

The mobile app additionally needs JDK 17 and the Android SDK; see
[`mobile/README.md`](mobile/README.md), which covers the `ANDROID_HOME` step
that trips most people up.

## Before you open a pull request

```bash
./gate.sh
```

That is the whole check: type-check, lint and tests across all three workspaces.
CI runs the same thing. **A green gate is the bar** — there is no separate list
of things to remember.

If the gate is red on something you did not touch, check `git status` first;
this repo is sometimes worked on from more than one place at once.

## Where code goes

- `service/` — everything both apps share: the graph, the tools, the agent, the
  React hooks. It is compiled **unchanged** into a browser and into React Native,
  so it may not import `node:` anything, touch the DOM, read the clock, or reach
  the network. Four scripts in `service/scripts/` enforce that and run as part of
  the lint step.
- `web/` and `mobile/` — only what is genuinely platform-specific. If you find
  yourself writing the same file twice, it belongs in `service/`.

`service/README.md` is the best description of the architecture and worth
reading before a first change there.

## House style

The code is heavily commented, and the comments explain **why** rather than
what. If you fix a bug, the comment that matters is the one saying what went
wrong and why the new shape prevents it — that is what stops the next person
undoing it.

Tests are expected with behaviour changes. The suite is written to fail loudly
on the specific thing that broke rather than on a snapshot, and a test that
passes whether or not the fix is present is not worth having.

## Reporting things

- **A bug or an idea**: open an issue.
- **A security problem**: don't. See [SECURITY.md](.github/SECURITY.md).
