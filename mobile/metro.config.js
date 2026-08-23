const path = require('node:path')

// This was `require('expo/metro-config')` until the ejection, and everything
// else in this file was written under that form and proven on a device before
// the swap — deliberately, so the change below had to reproduce a known-good
// answer rather than discover one.
//
// The swap is one line of diff and a whole transform pipeline underneath. It
// also changes `babelTransformerPath`, `unstable_conditionNames`,
// `unstable_conditionsByPlatform`, `sourceExts` and `assetExts`. If a bundle
// starts failing here, suspect the condition set before anything else.
const { getDefaultConfig } = require('@react-native/metro-config')

const projectRoot = __dirname
const workspaceRoot = path.resolve(projectRoot, '..')

const config = getDefaultConfig(projectRoot)

/*
 * [WORKSPACE] Expo computed all three of the settings below from the root
 * `workspaces` globs, for free. Bare React Native defaults to
 * `watchFolders: []`, `nodeModulesPaths: []` and `serverRoot: projectRoot` —
 * under which `service/` is simply invisible to the bundler.
 *
 * So these lines are the workspace's, not the ejection's. They are needed with
 * or without Expo, and writing them here while Expo still resolves everything
 * is what makes the ejection reproduce a known-good answer rather than discover
 * one in the middle of a native rewrite.
 */
config.watchFolders = [
  path.join(workspaceRoot, 'node_modules'),
  path.join(workspaceRoot, 'service'),
]

config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
]

/*
 * The one that gets forgotten. Without it the dev server cannot address a module
 * outside `projectRoot` at all.
 *
 * CONSEQUENCE, and it is load-bearing: the native bundle root is a path
 * RELATIVE TO THIS. `MainApplication.getJSMainModuleName()` and AppDelegate's
 * `jsBundleURL(forBundleRoot:)` must therefore both say `"mobile/index"`, never
 * `"index"` — Metro resolves the entry through `path.resolve(serverRoot,
 * entryFile)`.
 *
 * Getting it wrong fails the DEBUG bundle only, because release bundling goes
 * through gradle's explicit `entryFile`. So `assembleRelease` succeeds while
 * `run-android` dies on a resolution error wearing the costume of an alias bug.
 */
config.server = { ...config.server, unstable_serverRoot: workspaceRoot }

/*
 * [EJECTION] The replacement for tsconfig `paths`.
 *
 * 945 `@/…` specifiers across 129 files used to resolve because `@expo/cli`
 * wrapped Metro's resolver with a tsconfig-paths implementation, in both `start`
 * and `export:embed`. Bare React Native's Metro has no notion of tsconfig paths
 * whatsoever, so from the ejection onward this shim is the only thing standing
 * between those specifiers and a bundle that fails on the first import of every
 * file. `tsconfig.json`'s `paths` block now only tells `tsc` what this tells
 * Metro; the two agree by hand.
 *
 * `extraNodeModules` cannot express it: metro-resolver splits a specifier that
 * begins with `@` at the SECOND slash, so `@/lib/labels` parses as the scoped
 * package `@/lib`. `resolveRequest` is the only reliable route.
 *
 * The recursion is safe. Inside a custom `resolveRequest`, `context.resolveRequest`
 * is Metro's own `resolve`, which handles an absolute path immediately.
 */
const ALIASES = [['@/', path.join(projectRoot, 'src') + path.sep]]

/*
 * The one Expo package that will not leave, stubbed out of the graph.
 *
 * `@react-native-vector-icons/common` declares `expo-font` as an OPTIONAL peer.
 * It is no longer INSTALLED — `legacy-peer-deps=true` in the root `.npmrc` stops
 * npm auto-installing optional peers, and that took the whole Expo tree out of
 * the workspace — but the import edge is still in the package's source, and an
 * unresolvable require is a build error rather than a missing feature. So this
 * stub went from "the way to keep an unwanted package out of the bundle" to
 * "the way the bundle resolves at all", which is a promotion, not a retirement.
 *
 * `common/index.js` re-exports `dynamicLoading/dynamic-loading-setting`, whose
 * top level reads:
 *
 *     if (Platform.OS === 'web' && globalThis.expo) { try { require('expo-font') } catch {} }
 *
 * Three guards, and Metro honours none of them — bundling is static, so the
 * `require` is a graph edge regardless. `createIconSet` is on that path, which
 * means every one of the 24 screens with an icon drags `expo-font` in. Using the
 * `/static` entry point avoids the RUNTIME dynamic-font path; it does not
 * change the import graph.
 *
 * It bundled under Expo only because `expo-asset` — which `expo-font` imports —
 * happened to be hoisted where it could be found. That resolution was luck, and
 * it was luck that depended on WEB's dependency tree: `expo` used to survive in
 * the workspace only as a transitive of `@react-three/fiber`, which mobile does
 * not use and cannot see. Mobile must not be able to break when web changes a
 * dependency it does not share, and with this stub it cannot — the edge is cut
 * here rather than resolved by accident somewhere else.
 *
 * `{ type: 'empty' }` is Metro's own empty module, and it is exactly right here
 * rather than a lesser evil. The `require` above is side-effect-only — it exists
 * so that importing `expo-font` on WEB registers a module — and it cannot
 * execute on a phone, where `Platform.OS` is 'android' or 'ios'. Nothing reads a
 * binding from it. Feature detection is separate and already answers correctly
 * without any of this: `getIsDynamicLoadingSupported` tests `globalThis.expo?.modules`,
 * which a bare app does not have, so dynamic loading reports unsupported — the
 * five faces this app uses are linked natively and none of them wants it.
 */
const STUBBED = new Set(['expo-font'])

const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED.has(moduleName)) return { type: 'empty' }
  for (const [prefix, target] of ALIASES) {
    if (moduleName.startsWith(prefix)) {
      return context.resolveRequest(context, target + moduleName.slice(prefix.length), platform)
    }
  }
  return (upstream ?? context.resolveRequest)(context, moduleName, platform)
}

/*
 * Deliberately NOT extended to cover `service/`.
 *
 * This shim has no `node_modules` guard — Expo's tsconfig resolver did — so a
 * `@/…` specifier inside a package would now resolve. `service/` must still use
 * relative imports internally: web builds it with Vite, and it has its own
 * `tsc -b` and vitest, so the binding constraint is the strictest consumer.
 * Letting mobile's bundler decide the shared layer's import style would
 * re-couple that layer to one app, which is the thing the extraction exists to
 * undo.
 */

module.exports = config
