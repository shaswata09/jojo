/*
 * [EJECTION — TEMPORARY. Delete this file at step 11, when `expo` is uninstalled.]
 *
 * Nothing here pins paths: `npx react-native config` already resolves
 * `reactNativePath` and both platform `sourceDir`s correctly under npm
 * workspace hoisting, unaided. This file exists for exactly one reason.
 *
 * `node_modules/expo/react-native.config.js` is meant to opt itself out of
 * autolinking on a project that does not use Expo modules — it greps
 * `android/settings.gradle` for "useExpoModules", which step 10 removed. It
 * never gets that far: it locates the project with
 * `expo-modules-autolinking`'s `findProjectRootSync()`, which returns a path to
 * `package.json` rather than the directory containing it, so the path it stats
 * is `mobile/package.json/android/settings.gradle`. That cannot exist, and the
 * miss is read as "managed app" — the branch that claims an Android platform.
 *
 * Left alone, Gradle then autolinks `node_modules/expo/android`, whose
 * build.gradle applies `expo-module-gradle-plugin` — the plugin step 10 just
 * removed from settings.gradle — and configuration fails.
 */
module.exports = {
  dependencies: {
    expo: { platforms: { android: null, ios: null } },
  },
}
