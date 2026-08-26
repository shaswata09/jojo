# Security

jojo holds job applications, CVs, contact details for real people, and — if you
connect a cloud model — an API key. If you find a way to get at any of that,
please tell us before you tell anyone else.

## Reporting

Use GitHub's **[private vulnerability reporting](../../security/advisories/new)**.
It goes to the maintainers and nobody else, and it does not create a public
issue.

If that is unavailable to you, open an issue saying only *"security report, please
make contact"* — with no details — and wait to be contacted.

Please include, as far as you can: what you did, what happened, what you expected,
and which of the three platforms (web, Android, iOS) you saw it on.

## What we will do

We will acknowledge within a week, tell you whether we agree it is a
vulnerability, and keep you informed until it is fixed or closed. If you would
like credit in the release notes, say so; if you would rather not be named, that
is fine too.

## Scope

**In scope**

- Anything that gets data out of the device without the user asking: the backup
  and export paths, the transfer feature, the capture extension, crash reports
  and usage analytics.
- Anything that leaks the model API key. It is stored beside the graph and never
  inside it, so it cannot ride along in a backup — a way to make it do so is a
  vulnerability.
- The agent's tool gate: a way to make a tool run that was never offered, or to
  get a destructive tool past the approval step.
- Injection through content jojo reads: a captured job posting, an uploaded
  document, or a job board page persuading the agent to act.

**Out of scope**

- The model you connect. jojo sends it your records because that is what it is
  for; what a third-party provider does with them is their terms, which the app
  links to before you connect.
- Anything requiring physical access to an unlocked device.
- Dependency advisories with no reachable path in this app — please still report
  them, but as an ordinary issue.

## What jojo already promises

The README and the in-app licence page state these, and the test suite pins
some of them:

- Records live on the device. There is no jojo server.
- The API key is kept outside the graph, so a backup or a transfer cannot carry
  it. `web/src/lib/keys-stay-local.test.ts` fails the build if that stops being
  structurally true.
- Crash reports redact API keys, bearer tokens, query strings, home-directory
  usernames and email addresses before sending.
- Usage analytics use a closed vocabulary with no free text, and are off until
  you are asked.
