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
globs, for free. The ejection _removes_ that automatic wiring and step 1 writes
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

## A sixth thing, found on the last step: one Expo package cannot be uninstalled

`@react-native-vector-icons/common` declares `expo-font` as an **optional peer
dependency**, and npm installs it regardless. Uninstalling `expo` from the
workspace therefore does not remove `expo-font`, and `common/index.js`
re-exports `dynamicLoading/dynamic-loading-setting`, whose top level reads:

```js
if (Platform.OS === "web" && globalThis.expo) {
  try {
    require("expo-font");
  } catch {}
}
```

Three guards, and **Metro honours none of them** — bundling is static, so the
`require` is a graph edge whatever the conditions say. `createIconSet` sits on
that path, which means every screen with an icon drags `expo-font` in. Choosing
the `/static` entry point avoids the _runtime_ dynamic-font path; it does not
change the import graph, and the plan's step 4 was right about the first and
silent about the second.

It bundled anyway under Expo, because `expo-asset` — which `expo-font` imports —
happened to be hoisted where Metro could find it. Uninstalling `expo` left
`expo-font` hoisted at the workspace root and `expo-asset` nested under
`node_modules/expo/`, reachable only from there, and the bundle stopped
building. That resolution had been luck, and it was luck that depended on
**web's** dependency tree: `expo` survives in this workspace only as a transitive
of `@react-three/fiber`. Mobile must not be able to break when web changes a
dependency it does not share.

The fix is a `{ type: 'empty' }` branch in `metro.config.js`'s `resolveRequest`,
and it is exactly right rather than a lesser evil: that `require` is
side-effect-only — it exists so importing `expo-font` on **web** registers a
module — and it cannot execute on a phone, where `Platform.OS` is not `'web'`.
Nothing reads a binding from it. Feature detection is separate and already
answers correctly without any of it: `getIsDynamicLoadingSupported` tests
`globalThis.expo?.modules`, which a bare app does not have.

Verified in the shipped bundle: `expo-asset` and `expo-modules-core` appear zero
times, and the single remaining `expo-font` occurrence is a string inside a
vector-icons error message.

## A seventh, cheaper one: `--entry-file` is resolved against `serverRoot` too

The plan writes down that `getJSMainModuleName()` must be `"mobile/index"` rather
than `"index"` because `unstable_serverRoot` is the repo root. The same rule
applies to the CLI:

```
npx react-native bundle --entry-file index.ts    # error: <repo root>/index.ts not found
npx react-native bundle --entry-file mobile/index.ts   # works
```

Gradle is unaffected — `entryFile = file("../../index.ts")` is absolute, and an
absolute path wins over `path.resolve(serverRoot, entryFile)`. So this is a third
place the same trap shows up, and the second where release builds cannot see it.

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
_and_ its `new URL` behaviour changes when Expo's spec-compliant `URL` goes away.
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

## iOS, in the end

Done as steps 12 and 13, surgically, the same way Android was. `AppDelegate.swift`
reparented to `UIResponder`/`UIApplicationDelegate` with `RCTReactNativeFactory`;
the Podfile rewritten to the template shape with `platform :ios, '16.4'`
hardcoded and `use_native_modules!` taking no argument;
`Podfile.properties.json`, `Expo.plist` and the `Supporting` group deleted; the
Expo bundling `shellScript` replaced; `PrivacyInfo.xcprivacy` added by hand.

Three things worth writing down, because they are not in the plan.

**The `mobile/index` trap has an iOS third form.** It was known for
`getJSMainModuleName()` and for `jsBundleURL(forBundleRoot:)`. The Xcode bundling
phase is the third: `react-native-xcode.sh` defaults `ENTRY_FILE` to
`index.js`, relative, and `react-native bundle` resolves a relative
`--entry-file` against Metro's `serverRoot`. Measured — `--entry-file index.ts`
from `mobile/` fails with ``The resource `<repo root>/index.ts` was not found``.
The phase now exports an absolute `ENTRY_FILE`, which is the same shape as
gradle's `entryFile = file("../../index.ts")`.

**`PrivacyInfo.xcprivacy` is not purely an Expo debt.** React Native aggregates
it too: `use_react_native!` defaults `privacy_file_aggregation_enabled` to true,
and `PrivacyManifestUtils.add_aggregated_privacy_manifest` reads any existing
file, merges the required-reason APIs of every installed pod into it, and writes
it back. Committing one by hand is still right — it means the repo states its own
position (nothing collected, no tracking) rather than inheriting whatever the pod
set happened to imply — but it is a floor that `pod install` adds to, not a
snapshot.

**`pod install` is now load-bearing before the first build.**
`react_native_post_install` writes `REACT_NATIVE_PATH` into the user project's
build settings, and the bundling phase reads it. The Expo phase did not need it
because it resolved everything through node.

### The font decision: a third route, and why the plan's two were both wrong

The plan offered `fontFamily: 'Inter'` plus `fontWeight` (idiomatic, re-tunes
every weight) or patching the five `name` tables (keeps `tokens.ts`
byte-identical, five unreviewable binaries). Neither was taken.

The first is **broken for these specific files**, and it was measured rather than
argued about. Only `Inter-Regular` and `Inter-Bold` declare the family `Inter`;
`Inter_500Medium` and `Inter_600SemiBold` declare the families `Inter Medium` and
`Inter SemiBold`, with `Inter` only as their typographic family — `name` ID 16,
which is not what CoreText groups by. So `fontNamesForFamilyName(@"Inter")`
returns two faces and `RCTFontWithFontProperties` picks the nearest weight among
those: asking for 500 or 600 yields Bold. Medium and SemiBold would have rendered
one and two steps too heavy, silently, on a green gate.

The second is unnecessary, because the invariant it was reaching for can be had
from the other side. The two platforms' rules have exactly one string in common
per face — Android matches the asset **filename**, iOS falls back to
`UIFont(name:)` which takes the **PostScript name** — so instead of patching the
PostScript name to match the filename, the **filename was renamed to match the
PostScript name**. `Inter_400Regular.ttf` → `Inter-Regular.ttf`, and the five
strings in `tokens.ts` follow. Five `git mv`s and a five-line diff, no binary
touched, no weight re-tuned, and no script to lose.

Verified: `assembleRelease` still packages all six fonts at `assets/fonts/*.ttf`
and the release bundle carries each new name exactly once and none of the old
ones. The full write-up is in `docs/mobile-fonts.md`.

### What is still unproven, and it is a lot

Only Command Line Tools are installed on the machine this was done on — no Xcode,
no simulator — and the local CocoaPods cannot load (its Ruby is missing openssl
1.1). So there has been **no `pod install`, no compile, and no run**. What was
checked is what a machine without Xcode can check: the pbxproj parses via
`plutil`, the Swift parses via `swiftc -parse`, the Podfile is valid Ruby, every
`UIAppFonts` entry resolves to a file that exists or to a pod resource,
`npx react-native config` reports an iOS podspec for all eleven native modules,
and the release JS bundle builds for `--platform ios` (3,084,749 bytes, zero
`expo-asset` or `expo-modules-core` strings).

`ios/` should be treated as unverified until someone builds it.
