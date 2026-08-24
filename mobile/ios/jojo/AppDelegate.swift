import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import FirebaseCore

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    /*
     * Firebase, BEFORE React Native starts.
     *
     * Crashlytics installs its signal handlers inside `configure()`, so a crash
     * during React Native's own startup — a bad bundle, a native module that
     * throws while linking — is only caught if this ran first. That is also the
     * class of crash least likely to be reproducible on a developer's machine,
     * which makes it the class most worth catching.
     *
     * GUARDED, and the guard is not defensive programming. `FirebaseApp
     * .configure()` raises an uncaught NSException when GoogleService-Info.plist
     * is missing, which on iOS is an immediate crash on launch with no message a
     * user could act on. That file is gitignored — deliberately, so a fork does
     * not report ITS crashes into THIS project's console — so "missing" is the
     * normal state for anybody who has cloned jojo and pressed Run. Without this
     * check their first build would launch and die, and the reason would be a
     * file they were never told about.
     *
     * The JavaScript side already treats an absent Firebase as normal: see
     * `mobile/src/lib/crash.ts` and `mobile/src/lib/analytics.ts`, both of which
     * resolve the native module lazily and no-op when it is not there.
     */
    if Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist") != nil {
      FirebaseApp.configure()
    } else {
      NSLog("jojo: no GoogleService-Info.plist — running without Firebase.")
    }

    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    // "main" is the name `index.ts` hands to AppRegistry.registerComponent and
    // the name Android's getMainComponentName() returns. All three have to agree.
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions
    )

    return true
  }

  // Deep links — `jojo://`. The React Native template does not have these two
  // methods; the Expo AppDelegate did, and they are the only thing that routes an
  // incoming URL into RCTLinkingManager. They lost their `super.` halves along
  // with ExpoAppDelegate: UIResponder has no implementation to chain to, and
  // these are UIApplicationDelegate protocol methods rather than overrides.
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    return RCTLinkingManager.application(
      application, continue: userActivity, restorationHandler: restorationHandler)
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
    #if DEBUG
      // "mobile/index", NOT "index". Metro's serverRoot is the repo root (set by
      // metro.config.js so `service/` resolves), and the bundle root is a path
      // relative to it. Measured on the Android side: /index.bundle 404s with an
      // UnableToResolveError while /mobile/index.bundle serves. Release does not
      // go through here, so this is a debug-only failure.
      return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "mobile/index")
    #else
      return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
}
