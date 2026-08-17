const path = require('node:path')

// [EJECTION] Ships today in its `expo/metro-config` form so it can be proven on
// a device while Expo still works. Step 11 swaps this one line for
// `require('@react-native/metro-config')`.
//
// That swap is not cosmetic: it also changes `babelTransformerPath`,
// `unstable_conditionNames`, `unstable_conditionsByPlatform`, `sourceExts` and
// `assetExts`. One line of diff, a whole transform pipeline underneath. Treat
// the first failure after the swap as a condition-set problem before suspecting
// anything else.
const { getDefaultConfig } = require('expo/metro-config')

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
 * 945 `@/…` specifiers across 129 files resolve today only because `@expo/cli`
 * wraps Metro's resolver with a tsconfig-paths implementation, in both `start`
 * and `export:embed`. Bare React Native's Metro has no notion of tsconfig paths
 * whatsoever, so without this the bundle fails on the first import of every
 * file.
 *
 * `extraNodeModules` cannot express it: metro-resolver splits a specifier that
 * begins with `@` at the SECOND slash, so `@/lib/labels` parses as the scoped
 * package `@/lib`. `resolveRequest` is the only reliable route.
 *
 * The recursion is safe. Inside a custom `resolveRequest`, `context.resolveRequest`
 * is Metro's own `resolve`, which handles an absolute path immediately.
 */
const ALIASES = [['@/', path.join(projectRoot, 'src') + path.sep]]

const upstream = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
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
