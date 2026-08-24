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

| | App Distribution | Test Lab |
| --- | --- | --- |
| **Android** | yes | yes |
| **iOS** | yes | not wired up (see the note at the end) |
| **Web** | n/a | n/a |

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

| Where in the console | Looks like | Used as |
| --- | --- | --- |
| Project settings → General → **Project ID** | `jojo-1a2b3` | `FIREBASE_PROJECT_ID` |
| Project settings → Your apps → Android → **App ID** | `1:123456789012:android:0a1b…` | `FIREBASE_ANDROID_APP_ID` |
| Project settings → Your apps → iOS → **App ID** | `1:123456789012:ios:0a1b…` | `FIREBASE_IOS_APP_ID` |

The App ID is **not** the package name and **not** the project id. Copying the
wrong one is the commonest failure and the error does not say so.

> `google-services.json` and `GoogleService-Info.plist` are **not needed for
> either product**. They are needed only if you wire up the Crashlytics native
> SDK — see `mobile/src/lib/crash.ts`, which treats their absence as normal.

## 2. A service account for CI

Distribution and Test Lab both authenticate as a service account. One key does
both.

1. Google Cloud console → **IAM & Admin → Service Accounts** → *Create*, in the
   same project. Call it something like `jojo-release`.
2. Grant these roles, and no more:
   - **Firebase App Distribution Admin** — to upload builds
   - **Firebase Test Lab Admin** — to run device tests
   - **Cloud Storage Object Admin** *(Test Lab only)* — Test Lab writes its
     results to a bucket
3. **Keys → Add key → JSON.** Download it. This file is a credential: it is not
   committed, and the workflow writes it to the runner's temp directory and
   deletes it in a step that runs even when the build failed.

## 3. Tester group

App Distribution → **Testers & Groups** → create a group. The workflows default
to a group named **`testers`**; to use another name set a repository *variable*
(not a secret) called `FIREBASE_TESTER_GROUP`.

A missing group does not fail the build — the upload warns and the binary is
still attached to the run.

## 4. Repository secrets

**Settings → Secrets and variables → Actions.**

### For Android distribution and Test Lab

| Secret | Value |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | the whole JSON key file, pasted |
| `FIREBASE_ANDROID_APP_ID` | the Android App ID |
| `FIREBASE_PROJECT_ID` | the project id |

Set all three and the android job starts sending every build to testers, and
runs a Test Lab smoke test on tags. Set none and it does neither, silently.

### For iOS as well

| Secret | Value |
| --- | --- |
| `FIREBASE_IOS_APP_ID` | the iOS App ID |
| `IOS_CERTIFICATE_BASE64` | your distribution certificate: `base64 -i cert.p12` |
| `IOS_CERTIFICATE_PASSWORD` | the password you set when exporting it |
| `IOS_PROVISIONING_PROFILE_BASE64` | an ad-hoc profile: `base64 -i jojo.mobileprovision` |
| `IOS_TEAM_ID` | your ten-character Apple team id |

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

# A Robo test on a real device — no test code needed
FIREBASE_PROJECT_ID=jojo-1a2b3 npm run testlab

# iOS: archive and export from Xcode first, then
FIREBASE_IOS_APP_ID=1:123…:ios:0a1b… npm run distribute:ios
```

Both scripts read everything from the environment, so no id or key is written
into this repository. Put them in your shell profile, or a `.env` you do not
commit.

`npm run testlab` needs the `gcloud` CLI (`brew install --cask google-cloud-sdk`)
and `gcloud auth login`. Distribution needs neither — it uses `npx firebase-tools`.

## 6. Checking it worked

- **App Distribution** → the release appears under *Releases*, and testers on the
  group get an email. A tester on iOS must have their device UDID in the
  provisioning profile; ad-hoc distribution cannot reach a device that is not in
  it, and Firebase will not tell you that — the invite simply fails to install.
- **Test Lab** → the run appears under *Test Lab → Tests* with a video, a logcat
  and a crash report if it found one. A Robo test that finds nothing is a pass.

## The quotas that matter

| | Free allowance |
| --- | --- |
| App Distribution | no cost, no published cap |
| Test Lab virtual devices | **10 runs/day** |
| Test Lab physical devices | **5 runs/day** |

The Test Lab ceiling is why CI runs it **only on tags** and on **one** device.
Wiring it to every push would spend the day's allowance by mid-morning and then
fail builds for a reason that has nothing to do with the code.

## Known gap

**Test Lab is not wired up for iOS.** It supports iOS, but only with an XCTest
bundle — there is no Robo test for iOS, so unlike Android it cannot smoke-test an
app with no test code, and jojo has no XCTest target. Adding one is real work and
is not pretended at here. The iOS job builds, signs and distributes; it does not
device-test.
