# Getting a build to testers

What to create in Firebase, which values to copy where, and what happens without
any of it.

**Nothing here is required.** Every step below is skipped when its secrets are
absent: the gate still runs, the APK is still built and attached to the run, and
a fork or a first clone goes green having never heard of Firebase. That is
deliberate — a pipeline that fails without credentials nobody outside the project
can hold turns a contributor's first pull request into a red tick they cannot fix.

---

## What this covers, and what it cannot

|             | App Distribution | Test Lab                                     |
| ----------- | ---------------- | -------------------------------------------- |
| **Android** | yes              | instrumentation suite + Robo crawl — see §5b |
| **iOS**     | yes              | not wired up (see the note at the end)       |
| **Web**     | n/a              | n/a                                          |

**There is no web equivalent and this is not an omission.** App Distribution
hands testers a binary to install; a static site has no binary, and the deployed
page is already the thing a tester would open. The web app's release path is the
existing `deploy` job.

Neither product puts an SDK in the app. App Distribution uploads a finished
APK/IPA and Test Lab installs one — a build that went to testers is byte-identical
to one that did not, and neither adds a line to the bundle or a byte to what jojo
sends. That is why these two are the Firebase products this project takes without
argument, while Performance Monitoring is refused (it would silently record the
addresses of your local model server) and App Check is pointless here (it guards
Firebase backends, and jojo has none).

---

## 1. The Firebase project

One project covers everything, including the Crashlytics and Analytics work
already in the tree.

1. <https://console.firebase.google.com> → **Add project**. Google Analytics is
   optional at this step and can be added later; it is what
   `VITE_ANALYTICS_ID` needs.
2. **Add an Android app.** Package name **`dev.jojo.tracker`** — it must match
   `applicationId` in `mobile/android/app/build.gradle` exactly or uploads are
   rejected with a message about an unknown app.
3. **Add an iOS app.** Bundle ID **`dev.jojo.tracker`**, matching
   `PRODUCT_BUNDLE_IDENTIFIER` in the Xcode project.

### The three values to copy

| Where in the console                                | Looks like                     | Used as                   |
| --------------------------------------------------- | ------------------------------ | ------------------------- |
| Project settings → General → **Project ID**         | `jojo-1a2b3`                   | `FIREBASE_PROJECT_ID`     |
| Project settings → Your apps → Android → **App ID** | `1:123456789012:android:0a1b…` | `FIREBASE_ANDROID_APP_ID` |
| Project settings → Your apps → iOS → **App ID**     | `1:123456789012:ios:0a1b…`     | `FIREBASE_IOS_APP_ID`     |

The App ID is **not** the package name and **not** the project id. Copying the
wrong one is the commonest failure and the error does not say so.

> `google-services.json` and `GoogleService-Info.plist` are **not needed for
> either product**. They are needed for Crashlytics and Analytics, which are
> wired up — see the next section.

## 1b. Crashlytics and Analytics — where each file goes

Both are wired up on all three platforms. **Nothing here is required either**: a
checkout without these files builds and runs, and reports nothing.

| Platform | File                        | Goes at                                    | In git?         |
| -------- | --------------------------- | ------------------------------------------ | --------------- |
| Android  | `google-services.json`      | `mobile/android/app/google-services.json`  | no — gitignored |
| iOS      | `GoogleService-Info.plist`  | `mobile/ios/jojo/GoogleService-Info.plist` | no — gitignored |
| Web      | the `firebaseConfig` values | `.env` at the repo root                    | no — gitignored |

They are kept out of the repository so that **a fork does not report its crashes
and its traffic into this project's console**. That is also why CI reads them
from repository settings rather than from the tree.

### Android

Drop the file in and build. `android/app/build.gradle` applies the Google
Services and Crashlytics plugins only `if (file('google-services.json')
.exists())`, so a checkout without it logs one line and carries on.

### iOS

Drop the file in at `mobile/ios/jojo/`, then `cd mobile/ios && pod install`.

`AppDelegate.swift` calls `FirebaseApp.configure()` only when the plist is
actually in the bundle — without that guard, a clone without the file crashes on
launch, because `configure()` raises rather than returning an error.

> **Do not add the Firebase SDK through Xcode ▸ File ▸ Add Packages**, which is
> what the Firebase console suggests. react-native-firebase brings Firebase in
> through CocoaPods here; a second copy from Swift Package Manager is a
> duplicate-symbol link failure. The Podfile sets `$RNFirebaseDisableSPM = true`
> for the same reason — RNFB 26 defaults to SPM, and SPM does not work with this
> project's static linkage.

### Web

Copy `.env.example` to `.env` at the repo root and fill in the seven values from
the console (Project settings ▸ General ▸ Your apps ▸ Web). Vite reads that file
— `web/vite.config.ts` points `envDir` at the repo root.

These values are **not secret**: Google publishes them as public, they ship
inside the bundle of any Firebase web app, and `apiKey` identifies a project
rather than authorising anything. They are gitignored for the fork reason above,
not for confidentiality — which is why CI takes them as repository **variables**
rather than secrets.

### react-native-firebase is pinned to 25.x on purpose

**Do not bump these three packages to 26 or later.** RNFB 26's iOS TurboModule
returns `ModuleConstants<…::Constants::Builder>` from a React Native helper that
returns the non-Builder type in 0.81, so `RNFBAppModule.mm` fails to compile:

```
error: cannot initialize return object of type
'ModuleConstants<JS::NativeRNFBTurboApp::Constants::Builder>' with an rvalue of
type 'ModuleConstants<JS::NativeRNFBTurboApp::Constants>'
```

25.x implements the same method as a plain `- (NSDictionary *)constantsToExport`
and never touches the generated type, so it builds. The trap is that **Android
builds fine on 26** — it does not go through that codegen path — so a bump looks
successful right up until somebody builds for iOS.

Moving to 26 means moving React Native to 0.82 first.

### The build switches

Reporting is **on by default** where the build allows it, and each platform has
one place to turn the capability off entirely:

| Platform      | Where                                | Names                                    |
| ------------- | ------------------------------------ | ---------------------------------------- |
| Web           | `.env`                               | `VITE_CRASH_REPORTING`, `VITE_ANALYTICS` |
| Android / iOS | `mobile/src/lib/reporting-config.ts` | `crashes`, `analytics`                   |

The phone uses a source file rather than environment variables because React
Native inlines none: Metro replaces `process.env.NODE_ENV` and nothing else.

A build set to `false` cannot report however the in-app switches are set. The
in-app switches — the last page of the setup flow, and Settings — are what a
person uses; both default to on and both persist a refusal.

## 2. A service account for CI

Distribution and Test Lab both authenticate as a service account. One key does
both.

1. Google Cloud console → **IAM & Admin → Service Accounts** → _Create_, in the
   same project. Call it something like `jojo-release`.
2. Grant these roles, and no more:
   - **Firebase App Distribution Admin** — to upload builds
   - **Firebase Test Lab Admin** — to run device tests
   - **Cloud Storage Object Admin** _(Test Lab only)_ — Test Lab writes its
     results to a bucket
3. **Keys → Add key → JSON.** Download it. This file is a credential: it is not
   committed, and the workflow writes it to the runner's temp directory and
   deletes it in a step that runs even when the build failed.

## 3. Tester group

App Distribution → **Testers & Groups** → create a group. The workflows default
to a group named **`testers`**; to use another name set a repository _variable_
(not a secret) called `FIREBASE_TESTER_GROUP`.

A missing group does not fail the build — the upload warns and the binary is
still attached to the run.

## 4. Repository secrets

**Settings → Secrets and variables → Actions.**

### For Android distribution and Test Lab

| Secret                     | Value                                               |
| -------------------------- | --------------------------------------------------- |
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON key file, pasted                     |
| `FIREBASE_ANDROID_APP_ID`  | the Android App ID                                  |
| `FIREBASE_PROJECT_ID`      | the project id                                      |
| `GOOGLE_SERVICES_JSON`     | `base64 -i mobile/android/app/google-services.json` |

`GOOGLE_SERVICES_JSON` is what puts Crashlytics and Analytics into the APK that
CI builds; without it the workflow logs "building without Firebase" and produces
a working APK that reports nothing. Base64 because the raw JSON's newlines do
not survive a secret cleanly. The build step decodes it and then parses it with
`node`, so a truncated paste fails the job instead of quietly producing a
Firebase-less build.

Set all three and the android job starts sending every build to testers, and
runs a Test Lab smoke test on tags. Set none and it does neither, silently.

### For the deployed web app

These are repository **variables**, not secrets — Settings ▸ Secrets and
variables ▸ Actions ▸ _Variables_. See above for why they are not secret.

| Variable                       | Value                           |
| ------------------------------ | ------------------------------- |
| `CRASH_REPORTING`              | `true`                          |
| `ANALYTICS`                    | `true`                          |
| `FIREBASE_API_KEY`             | from the console's web config   |
| `FIREBASE_AUTH_DOMAIN`         | `<project>.firebaseapp.com`     |
| `FIREBASE_PROJECT_ID`          | the project id                  |
| `FIREBASE_STORAGE_BUCKET`      | `<project>.firebasestorage.app` |
| `FIREBASE_MESSAGING_SENDER_ID` | the sender id                   |
| `FIREBASE_APP_ID`              | the **web** app id, `1:…:web:…` |
| `ANALYTICS_ID`                 | the measurement id, `G-…`       |

Miss `ANALYTICS_ID` and the app initialises Firebase and reports nothing, which
looks identical to analytics working and nobody using it. `ANALYTICS_CAPABILITY`
refuses to come up without it for that reason.

### For iOS as well

| Secret                            | Value                                                |
| --------------------------------- | ---------------------------------------------------- |
| `FIREBASE_IOS_APP_ID`             | the iOS App ID                                       |
| `IOS_CERTIFICATE_BASE64`          | your distribution certificate: `base64 -i cert.p12`  |
| `IOS_CERTIFICATE_PASSWORD`        | the password you set when exporting it               |
| `IOS_PROVISIONING_PROFILE_BASE64` | an ad-hoc profile: `base64 -i jojo.mobileprovision`  |
| `IOS_TEAM_ID`                     | your ten-character Apple team id                     |
| `GOOGLE_SERVICE_INFO_PLIST`       | `base64 -i mobile/ios/jojo/GoogleService-Info.plist` |

These come from Apple, not Firebase, and there is no way round them: an iOS
archive cannot be produced in any form a tester can install without a signing
identity. The iOS job **only runs on a tag**, because a macOS runner bills at ten
times a Linux one and nothing it does catches a bug the gate has not already run.

## 5. Doing it from your own machine

Often better than pushing a tag — a build for one person to check one thing does
not deserve a version number.

```sh
# Android
cd mobile/android && ./gradlew assembleRelease && cd ..
FIREBASE_ANDROID_APP_ID=1:123…:android:0a1b… npm run distribute:android

# The instrumentation suite on a real device
cd android && ./gradlew -PjojoTestBuildType=release \
  assembleRelease assembleReleaseAndroidTest && cd ..
FIREBASE_PROJECT_ID=jojo-1a2b3 npm run testlab

# Or a Robo crawl, which needs no test code
FIREBASE_PROJECT_ID=jojo-1a2b3 npm run testlab -- --robo

# iOS: archive and export from Xcode first, then
FIREBASE_IOS_APP_ID=1:123…:ios:0a1b… npm run distribute:ios
```

Both scripts read everything from the environment, so no id or key is written
into this repository. Put them in your shell profile, or a `.env` you do not
commit.

`npm run testlab` needs the `gcloud` CLI (`brew install --cask google-cloud-sdk`)
and `gcloud auth login`. Distribution needs neither — it uses `npx firebase-tools`.

## 5b. What Test Lab actually runs

Two things, and only one of them gates a build.

**The instrumentation suite** is `mobile/android/app/src/androidTest`. It runs on
Google's devices at API 31 and 34 and asserts what nothing else in this project
can:

| Test                       | What it would catch                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `t1_launches`              | a missing JS bundle, an unlinked native module, a Hermes mismatch — every one of which ships with a green gate |
| `t2_tabsNavigate`          | navigation wired to screens that do not render                                                                 |
| `t3_deepLinkOpensTheApp`   | `jojo://` declared in the manifest and listened to by nothing                                                  |
| `t4_settingsOpens`         | a release build where the model and reader addresses cannot be configured                                      |
| `t5_survivesBackgrounding` | a bridge that does not survive resume, on the path every user takes daily                                      |

It runs **on `main` and on tags**, and a failure fails the job.

**The Robo crawl** walks the app with no test code and reports crashes and ANRs
on paths the suite never visits. It runs **on tags only** and reports as a
warning: a crawler takes a different route each run, so a red build from one is
not reproducible.

### Why the tests run against the release build

`-PjojoTestBuildType=release`, in CI and in the command above. A React Native
debug APK expects Metro to be serving the JS at runtime; Test Lab has no Metro
and no route back to one, so a debug APK there opens to a red box and every test
fails on a bundle that was never going to load.

Testing release also means Test Lab exercises the manifest that ships — which is
where this app's real defects have been. The build that shipped the whole
database to Google Drive, and the one where cleartext was denied so every local
model was unreachable, were both **release-only**: the debug manifest was
correct, so every developer saw it working.

Gradle signs the androidTest APK with the tested variant's `signingConfig`, so
both halves carry the same key — which is what Test Lab requires of an
instrumentation pair.

### Quota

The free tier is 10 virtual-device runs a day. The instrumentation run uses two
(one per API level) per push to `main`, so a busy day of merges can exhaust it.
If that starts failing builds for quota rather than for code, drop to one device
or move the trigger to tags.

## 6. Checking it worked

- **App Distribution** → the release appears under _Releases_, and testers on the
  group get an email. A tester on iOS must have their device UDID in the
  provisioning profile; ad-hoc distribution cannot reach a device that is not in
  it, and Firebase will not tell you that — the invite simply fails to install.
- **Test Lab** → the run appears under _Test Lab → Tests_ with a video, a logcat
  and a crash report if it found one. A Robo test that finds nothing is a pass.

## The quotas that matter

|                           | Free allowance            |
| ------------------------- | ------------------------- |
| App Distribution          | no cost, no published cap |
| Test Lab virtual devices  | **10 runs/day**           |
| Test Lab physical devices | **5 runs/day**            |

The Test Lab ceiling is why CI runs it **only on tags** and on **one** device.
Wiring it to every push would spend the day's allowance by mid-morning and then
fail builds for a reason that has nothing to do with the code.

## Known gap

**Test Lab is not wired up for iOS.** It supports iOS, but only with an XCTest
bundle — there is no Robo crawl for iOS, so unlike Android it cannot be pointed
at an app with no test code at all, and jojo has no XCTest target. The Android
equivalent of what would be needed is `app/src/androidTest`, which does exist;
an iOS suite would have to be written from nothing. Adding one is real work and
is not pretended at here. The iOS job builds, signs and distributes; it does not
device-test.
