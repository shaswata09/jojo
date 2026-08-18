# Removing Expo from `mobile/`

Decisions taken before any code moved, and the two facts that were wrong when
this was first proposed. Written 2026-08-17.

## The decision

`mobile/` moves from Expo SDK 54 to **bare React Native** (React Native CLI).
Still React Native, still TypeScript, still Metro. We own `android/` and `ios/`
from then on.

**iOS is IN.** Steps 12–13 of the plan apply: the Podfile is rewritten with
`platform :ios, '16.4'` hardcoded (`min_ios_version_supported` is 15.1, below
our floor), `AppDelegate.swift` is reparented, and `PrivacyInfo.xcprivacy` is
added by hand — Expo synthesised that at pod-install and this repo has none, so
App Store submission would be flagged without it.

**Fonts: deferred to step 12, unpatched.** The five TTFs are vendored as they
are and `mobile/src/theme/tokens.ts` stays byte-identical. Android resolves
`fontFamily` by filename and works as-is; iOS is the only platform where the
PostScript-name mismatch shows, and step 12 at a simulator is the first place it
can be observed rather than guessed at. If the patch route is taken then, it
must be a **committed, re-runnable script** — five patched binaries are five
assets no diff can review, and losing the script makes the work unreproducible
while a green `gate.sh` certifies a silent San Francisco fallback.

## What this buys, and what it does not

Build control and native-module freedom. Those are real and they are the reason.

**It does not improve service-layer reuse**, which is what it was first asked
for. Metro — not Expo — is what refuses to resolve outside `projectRoot`, and
bare React Native runs the same Metro. Worse, measured: Expo's Metro was already
computing `watchFolders: [root/node_modules, service, web, mobile]`,
`nodeModulesPaths` and `serverRoot: <repo root>` from the root `workspaces`
globs, for free. The ejection *removes* that automatic wiring and step 1 writes
it back by hand. Reuse comes from the workspace migration, with or without Expo.

## Two things the planning probes corrected

**`expo-file-system` is not the React Native half of the `FileStore` port.**
That framing was wrong and acting on it would have meant building an adapter for
an interface with no caller. The port lives at `web/src/kg/storage/file-store.ts`
and its only implementation anywhere is `memory-file-store.ts`.
`mobile/src/kg/storage/` has no `file-store.ts` at all — mobile's persistence is
the graph `Driver` over AsyncStorage, which is not an Expo package and is
untouched by this work. What `expo-file-system` actually does here is one
feature, Vault document attachments, inside `src/lib/documents.ts`.

**Regenerating the native projects was rejected.** 56 of the 74 files in a
regenerated tree would be restored from git anyway, and the two iOS items that
justified it turned out to be one — `OTHER_LDFLAGS = -ObjC` and
`LD_RUNPATH_SEARCH_PATHS` are already in the pbxproj. A single four-line shell
script is not worth retyping the bundle id, entitlements, deployment target,
seven `Info.plist` keys, the asset catalog and the splash storyboard into a
pbxproj full of fresh UUIDs that no diff can review.

## Three things that break silently if forgotten

Each of these fails without an error, which is why they are written here rather
than left in the plan.

**The Android 12 floor is enforced by Expo.** `expo-root-project` reads the
`android.minSdkVersion` / `compileSdkVersion` / `targetSdkVersion` lines out of
`gradle.properties` and into `rootProject.ext`. Delete the plugin without adding
an explicit `buildscript { ext { minSdkVersion = 31 … } }` and the floor vanishes
with no build error at all.

**`getJSMainModuleName()` must return `"mobile/index"`, not `"index"`.** Metro
resolves the bundle root against `serverRoot`, which under the workspace is the
repo root, where no `index.*` exists. This fails **debug-only** — release
bundling uses gradle's explicit `entryFile` — so `assembleRelease` succeeds while
`run-android` fails, wearing the costume of a resolver bug.

**`super.onCreate(null)` in `MainActivity` is not about the splash screen.** The
existing comment credits `expo-splash-screen` and is wrong: it is
`react-native-screens`' documented fix for a fragment-state-restoration crash,
and that crash fires **only on process-death restore** — the one path nobody
tests by hand.

## A fourth thing that breaks silently, found while doing it

**`react-native-blob-util` brings four permissions the app does not use.** Its
own `AndroidManifest.xml` declares `WAKE_LOCK`, `ACCESS_NETWORK_STATE`,
`ACCESS_WIFI_STATE` and `DOWNLOAD_WITHOUT_NOTIFICATION`, because it is a
networking and download library and this app uses only its `fs` and its
`actionViewIntent`. The manifest merger adds them without a word. Measured by
diffing `aapt dump badging` on the release APK against the pre-ejection
baseline: six permissions became ten.

That is a user-visible regression — it is what the Play listing shows — and
nothing in the build reports it. **The fix belongs to the Android native
surgery step**, which is already editing `AndroidManifest.xml`: add
`tools:node="remove"` entries for the four, and confirm against `badging`
afterwards rather than assuming.

It is also the first bill for what the ejection buys. Expo did not protect
against this either, but nobody had to notice before, because no native module
had been added by hand.

## A fifth thing, found during the surgery: Expo does not let go on its own

`node_modules/expo/react-native.config.js` is written to opt itself out of
autolinking when the project does not use Expo modules — it greps
`android/settings.gradle` for `useExpoModules`, which the native surgery
removes. **It never gets that far.** It locates the project with
`expo-modules-autolinking`'s `findProjectRootSync()`, which returns a path to
`package.json` rather than the directory holding it, so the path it stats is
`mobile/package.json/android/settings.gradle`. That cannot exist, and the miss
is read as "managed app" — the branch that claims an Android platform.

Left alone, Gradle then autolinks `node_modules/expo/android`, whose
`build.gradle` applies `expo-module-gradle-plugin` — the plugin the surgery just
removed from `settings.gradle` — and configuration fails.

The fix is a `mobile/react-native.config.js` that excludes `expo` by name. It is
**temporary**: it exists only for the window between the native surgery and the
step that uninstalls the package, and that step deletes it. It pins no paths —
`npx react-native config` resolves `reactNativePath` and both platform
`sourceDir`s correctly under workspace hoisting, unaided.

## Two questions the surgery answered

**`app/src/debugOptimized/` is not an orphan.** The `debugOptimized` build type
is created by the React Native Gradle plugin (`AgpConfiguratorUtils`), not by
anything of Expo's. Confirmed after the surgery: `:app:tasks --all` still lists
`installDebugOptimized`. The source set stays.

**Exactly one `FileProvider`.** Before the surgery the merged release manifest
carried two — `dev.jojo.tracker.provider` from `react-native-blob-util` and
`dev.jojo.tracker.FileSystemFileProvider`, still contributed because the `expo`
package depends on `expo-file-system`. With Expo out of the linked set, only
blob-util's remains, and its `provider_paths` `files-path "."` covers where
`keepLocalCopy` writes.

## Sequencing

**The service-layer migration goes first**, steps 2–8 complete and green, with
exactly one ejection artifact landed ahead of it: `mobile/metro.config.js`,
written while Expo still works so the riskiest change in the ejection is proven
on a device against a known-good answer.

`parse-posting.ts` is why the order is load-bearing. It moves into `service/`
*and* its `new URL` behaviour changes when Expo's spec-compliant `URL` goes away.
Land the move first, under the good `URL`, so the shared layer is fixed and green
before the runtime beneath it changes. Reversed, one file parses three ways —
one in service's vitest, one in web, one on the phone.

Source conflict between the two migrations is two files. The collision is
config, and step 1 resolves it.

## The one unbootable window

**Step 10, Android native surgery, ~4–8 hours — one working session.** It is the
only point where the app cannot build end to end. Everything before it runs on a
working Expo build; everything after it runs on a working bare build.

## A gate note

`gate.sh` reports mobile at 333 tests today. Service step 4 deletes 79 of
mobile's 81 `kg` files and those tests move to `@jojo/service`. After that, a
lower mobile count is not a regression — the number to watch is the total across
`service` + `mobile`.
