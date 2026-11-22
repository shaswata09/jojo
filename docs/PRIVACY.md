# jojo privacy notice

**Effective date: 21 November 2026**

This notice explains what happens to information when you use jojo. jojo is
local-first: it has no accounts and no server of its own, and your records stay on
your device. A few things can leave it, each only when you turn it on or point
jojo at it. This notice lists all of them.

The same text is published at <https://shaswata09.github.io/jojo/privacy.html>.

## Who is responsible

jojo is an open-source project maintained by **Shaswata Mitra**. This notice
covers the copy of jojo he publishes:

- the web app at <https://shaswata09.github.io/jojo/>,
- the Android and iOS app built from this repository, and
- the jojo browser extension.

Shaswata Mitra runs the hosted web app and the Firebase project that receives
usage analytics and crash reports from it. For that data he is the person
responsible for it (the "controller", in data-protection terms).

A copy of jojo that somebody else builds or hosts, such as a fork, is that
person's responsibility. Their copy reports to their own analytics, if it reports
anywhere at all, and this notice does not cover it.

**Contact.** Open an issue at <https://github.com/shaswata09/jojo/issues>. Issues
are public, so do not put personal details in one. If you need to discuss
something privately, open an issue that says so and leave the details out, and the
maintainer will reply there with a way to continue.

## The short version

- jojo has no accounts and no server of its own. Your applications, notes,
  documents, profile, contacts and API keys stay on your device. The maintainer
  never receives a copy.
- Two things can be sent to Google's Firebase, and both are **off until you turn
  them on**: usage analytics (web and phone) and crash reports (phone only).
- Anything else leaves only because you point jojo at it: a model provider you
  choose, the job boards your own scout pipelines read, your other device during
  Transfer, or an assistant you connect through the jojo bridge.
- jojo shows no ads and sells no data.

## What stays on your device

Everything you put into jojo is kept on the device you are using:

- applications, stages, notes, reminders and the timeline,
- people you record, such as referees, recruiters and hiring managers,
- your profile, CV text and the documents you attach,
- postings you keep, scout pipelines and what they find,
- conversations with the assistant,
- your settings, including any API key you enter.

On the web these are kept in your browser's storage for jojo's site. On the phone
they are kept in the app's own storage. In the browser extension, pages you keep
are stored in the extension until jojo files them. Nothing syncs between devices
unless you move it yourself, and no copy is held anywhere else. That also means
nobody else can recover your records if the device or browser data is lost, so
take backups: on the web, Settings → Download a backup; on the phone, the export
in Settings, or Transfer under More (see "Your choices and your rights" for what
each one carries).

On the web and in the extension, crash logs also stay on the device. You can read
them in Settings. They are never sent anywhere, and a backup file does not carry
them.

## What can leave your device, and when

### 1. Usage analytics (web and phone): off until you turn it on

If you turn on "Share which features I use", jojo sends usage events to
**Google Analytics for Firebase**.

**What jojo sends.** Only events from a fixed list, defined in
[`service/kg/core/analytics.ts`](../service/kg/core/analytics.ts). A test fails
the build if any of them is widened to free text. The events are:

- the app was opened, and which screen was opened (one of a fixed list of
  twelve, such as "applications" or "settings");
- an application was created, and how (typed in, from a link, from the scout or
  from a captured page), or moved to a stage;
- the assistant was asked something, with how many tools it had and whether a
  model was set up; a change it proposed was approved or declined, and whether
  that change was destructive;
- a scout pipeline was started, and a suggestion was approved or declined;
- the kind of item added to the vault (file, link, snippet, reminder, person or
  posting);
- a model connected or failed, with the type of provider (for example "ollama"
  or "anthropic"), the kind of failure and the step that failed. The address
  and the key are never sent;
- a document reader connected, and by which route;
- a backup was exported or restored, or a Transfer completed, with the number
  of records in bands (0, 1, 2–5, 6–20, 21–50, 50+), never the exact count;
- the guided tour was started or finished;
- an error was caught, with where in the app it happened, the type of error
  and whether it was fatal. The error message is not sent.

No event contains free text, an employer, a role, a person's name, a file name
or anything you type.

**What Google's software adds.** Like any analytics tool, the Firebase SDK adds:

- a random identifier for this installation. On the web this is a Google
  Analytics client ID in a `_ga` cookie and a Firebase installation ID in
  browser storage. On the phone it is an app-instance ID and a Firebase
  installation ID;
- the type of device, operating system or browser, the app version, the
  language and the screen size;
- an approximate location (country and region), which Google works out from your
  IP address;
- its own session events, such as a first visit or first open, the start of a
  session and time spent in the app.

On the web, the page address sent is only the site's origin, with no path or
query. Google signals and ad personalisation are switched off in jojo's code.
On the phone, the advertising ID, the Android ID and the iOS identifier for
vendors are not collected, Firebase's automatic screen reporting is off, and the
advertising consent settings are off.

**Legal basis.** Your consent. The switch starts off, and nothing is sent until
you turn it on.

**How to stop.** Turn the switch off in Settings at any time. On the web, turning
it off also deletes the analytics cookies and Firebase's stored installation data
from this browser. On the phone, it resets the analytics data, which clears the
app-instance ID and any events not yet uploaded.

**How long it is kept.** Event data is kept for as long as set in the analytics
property, at most 14 months, and then deleted by Google.

### 2. Crash reports (phone only): off until you turn it on

If you turn crash reports on in the phone app, a report is sent to **Firebase
Crashlytics** when something breaks.

**What jojo sends.** The error message and stack trace, and a label saying where
in the app it happened. Before a report is kept or sent, jojo removes API keys,
authorisation headers, web-address query strings, your home directory and file
paths, and email addresses. A report never contains your applications,
documents, notes, profile or conversations.

**What Crashlytics adds.** A random Crashlytics installation ID, the device model,
operating system version, app version, the time, and the device's state when it
crashed (such as orientation, free memory and disk space, and whether it is
rooted or jailbroken).

**Legal basis.** Your consent. The switch starts off.

**How to stop.** Turn it off in Settings. Collection stops, and reports that have
not been sent yet are deleted.

**How long it is kept.** Crashlytics keeps crash reports for 90 days.

On the web and in the extension, crash logs are never sent anywhere; see "What
stays on your device".

### Google's role, and transfers outside your country

For both usage analytics and crash reports, Google acts as a processor for the
maintainer, under a different set of terms for each:

- **Crash reports** (Firebase Crashlytics): the Firebase Data Processing and
  Security Terms.
- **Usage analytics** (Google Analytics for Firebase): the Google Ads Data
  Processing Terms, which the maintainer accepts for the analytics property. The
  property's settings for sharing data with Google are turned off.

Google processes the data on servers in the United States and elsewhere. For data from
the European Economic Area, the United Kingdom and Switzerland, the transfer
relies on the EU–US Data Privacy Framework (and its UK and Swiss extensions),
under which Google LLC is certified, and on the Standard Contractual Clauses in
Google's terms.

### 3. A model provider you choose

jojo does not need an AI model to work as a tracker. If you connect one, where
your records go depends on which one:

- **A model on your own machine or network** (Ollama, vLLM, LM Studio,
  llama.cpp): nothing leaves. The requests go to the address you enter.
- **A hosted provider** (Anthropic, OpenAI, OpenRouter or Groq), **or a server
  at an address that is not on your device or local network**: your records are
  sent to it. jojo shows a notice when you choose one.

While a hosted provider is selected, records are sent to it when you use the
assistant and also when jojo does background work with the model: the duplicate
check when you save an application, reading postings your scout finds, fit
readings against your profile, tailoring your CV and letters, and shortening a
long conversation so it fits. What is sent can include your applications and
notes, your profile, the text of your CV and other documents, and **other
people's details**, such as the names and email addresses of referees and
recruiters.

This happens under **your own agreement with that provider**. You use your own
API key. The request goes from your device to the provider, or through the jojo
extension when your browser needs it to, and never through the maintainer, who
cannot see it and is not a party to that agreement. The provider's own terms and
privacy policy decide what it keeps and whether it may use what you send to
improve its models. OpenRouter passes each request on to the company that makes
the model you pick, so that company's terms apply as well. jojo links each
provider's terms and privacy policy where you choose it.

Your API key is stored on your device, is never put in a backup, and is only
ever sent to the provider it belongs to.

### 4. Job boards your scout reads

Scout pipelines that you set up and run read job boards and careers pages that
you choose. Opening a posting address you paste works the same way. The request
comes from your device, either from the phone app or, on a computer, from your
browser through the jojo extension. The site sees what it sees on any visit: your
IP address, your browser, and, when the extension opens the page in your browser,
any account you are signed in to on that site. That site's own privacy policy
applies. What the scout finds is kept on your device.

### 5. Transfer between your devices

Transfer moves your records directly between your phone and your computer. The
two devices pair using the camera, connect to each other at a private network
address with no relay and no server in between, and encrypt everything they send
(X25519 key agreement and AES-GCM). Nothing goes to the maintainer.

A backup file is different. It is a file you save and move yourself, and it goes
wherever you put it.

### 6. Assistants you connect through the jojo bridge

If you turn on "Connect from an MCP client" in Settings, the small `jojo-bridge`
program runs on your computer and listens only on `127.0.0.1`. It passes messages
between an assistant you run, such as Claude Code, and the open jojo tab. What
that assistant reads through jojo's tools goes to its own model provider (for
Claude Code, Anthropic) under **your** plan and that provider's terms. jojo sends
nothing anywhere else.

### 7. A document reader

jojo can read PDFs, Word files and postings through Microsoft's MarkItDown,
which you run yourself. Documents are sent to the address you set for it and
nowhere else. If you set an address that is not on your machine, your documents
go there.

### Hosting

The web app is served by GitHub Pages, and the phone app and the extension are
downloaded from GitHub. Like any web host, GitHub receives your IP address and
browser details when you load a page or download a file, and handles them under
[GitHub's privacy statement](https://docs.github.com/site-policy/privacy-policies/github-general-privacy-statement).
The maintainer does not receive GitHub's access logs.

## Your choices and your rights

**Your records.** You hold them, so you exercise your rights over them on your own
device:

- **See and take a copy:** everything is in the app. On the web, Settings →
  Download a backup exports all of it in one file, documents included. On the
  phone, the export in Settings (Export as JSON) carries every record but not the
  contents of the documents you attached; Transfer, under More, moves
  everything, documents included, to a computer.
- **Correct:** edit any record in the app.
- **Delete:** Settings → Clear every record removes them. You can also clear
  jojo's site data in your browser, remove the extension, or uninstall the phone
  app.

The maintainer holds no copy of your records, so he cannot access, correct,
delete or recover them for you.

**Analytics and crash data.** You can withdraw consent at any time with the
switches in Settings. Withdrawing does not affect what was sent before. Because
jojo has no accounts, this data is tied only to a random installation
identifier, not to your name, so turning the switches off on your device is the
most reliable way to remove your identifier. You can also raise a request
through the contact above.

**Your rights under data-protection law.** Depending on where you live, including
under the EU and UK GDPR, you have the right to access, correct and delete your
personal data, to restrict or object to its use, to receive it in a portable
form, and to withdraw consent. You also have the right to complain to a
data-protection supervisory authority, in particular in the country where you
live or work (in the UK, the Information Commissioner's Office).

## Other people's details

People you record in jojo, such as referees, recruiters and contacts, are kept on
your device like everything else. If you choose a hosted model provider, their
details can be sent to it as described above. You decide whether that happens.

## Children

jojo is meant for adults looking for work. It is not intended for anyone under
16, and nobody under 16 should turn on usage analytics or crash reports.

## Changes to this notice

This notice is kept in the jojo repository as `docs/PRIVACY.md`, so every
earlier version is in its history. When it changes, the effective date at the top
changes, and a change to what can leave your device is described in the release
notes.
